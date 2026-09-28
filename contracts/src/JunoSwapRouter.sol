// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IUniswapV2Factory, IUniswapV2Pair, IWrappedNative} from "./interfaces/IUniswapV2.sol";

/// @title JunoSwapRouter
/// @notice Trades a graduated Juno coin against its Uniswap v2 pair, in one
/// transaction.
///
/// When a curve fills, `UniswapV2Graduator` moves its reserves into a v2 pair
/// and locks the liquidity. On Monad mainnet that pair belongs to Uniswap's
/// own factory and any v2 router can trade it; on testnet, which has no
/// official v2, it belongs to the v2-core factory Juno deploys, and nothing
/// else routes to it. Without this contract a coin stopped being tradeable in
/// the app at the moment it succeeded.
///
/// It is the minimum a router needs to be: find the pair, move the input into
/// it, ask the pair for the output the constant-product formula allows (with
/// v2's 0.3% fee), and check the caller's minimum and deadline. Native MON is
/// wrapped on the way in and unwrapped on the way out. It holds nothing
/// between calls, and it is the same code against any v2 factory, so one
/// deployment per network serves both.
contract JunoSwapRouter is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IUniswapV2Factory public immutable factory;
    address public immutable wrappedNative;

    /// @notice A swap through the router. The pair's own `Swap` event names the
    /// router as sender; this names the trader.
    event Swapped(
        address indexed pair,
        address indexed trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address to
    );

    error Expired();
    error NoPair();
    error ZeroAmount();
    error InsufficientLiquidity();
    error Slippage(uint256 got, uint256 wanted);
    error NotWrappedNative();
    error TransferFailed();

    constructor(IUniswapV2Factory factory_, address wrappedNative_) {
        factory = factory_;
        wrappedNative = wrappedNative_;
    }

    /// @dev Only the wrapped-native contract pays this router, when a sell is
    /// unwrapped. Anything else sending MON here would be stranded.
    receive() external payable {
        if (msg.sender != wrappedNative) revert NotWrappedNative();
    }

    /// @notice Buy `token` with all the MON sent.
    function buyWithNative(address token, uint256 minOut, address to, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 amountOut)
    {
        if (block.timestamp > deadline) revert Expired();
        if (msg.value == 0) revert ZeroAmount();
        address pair = _pairFor(wrappedNative, token);
        IWrappedNative(wrappedNative).deposit{value: msg.value}();
        IERC20(wrappedNative).safeTransfer(pair, msg.value);
        amountOut = _swap(pair, wrappedNative, token, to);
        if (amountOut < minOut) revert Slippage(amountOut, minOut);
        emit Swapped(pair, msg.sender, address(0), token, msg.value, amountOut, to);
    }

    /// @notice Sell `amountIn` of `token` for MON. Needs an allowance for this router.
    function sellForNative(address token, uint256 amountIn, uint256 minOut, address to, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (block.timestamp > deadline) revert Expired();
        if (amountIn == 0) revert ZeroAmount();
        address pair = _pairFor(token, wrappedNative);
        IERC20(token).safeTransferFrom(msg.sender, pair, amountIn);
        amountOut = _swap(pair, token, wrappedNative, address(this));
        if (amountOut < minOut) revert Slippage(amountOut, minOut);
        IWrappedNative(wrappedNative).withdraw(amountOut);
        // `to` is the seller's own choice of recipient for their own proceeds.
        // slither-disable-next-line arbitrary-send-eth
        (bool ok,) = to.call{value: amountOut}("");
        if (!ok) revert TransferFailed();
        emit Swapped(pair, msg.sender, token, address(0), amountIn, amountOut, to);
    }

    /// @notice Swap one token for another through their pair — a coin quoted
    /// in USDC, in either direction. Needs an allowance for `tokenIn`.
    function swapExactTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address to,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert Expired();
        if (amountIn == 0) revert ZeroAmount();
        address pair = _pairFor(tokenIn, tokenOut);
        IERC20(tokenIn).safeTransferFrom(msg.sender, pair, amountIn);
        amountOut = _swap(pair, tokenIn, tokenOut, to);
        if (amountOut < minOut) revert Slippage(amountOut, minOut);
        emit Swapped(pair, msg.sender, tokenIn, tokenOut, amountIn, amountOut, to);
    }

    /// @notice What a swap of `amountIn` would pay out right now, and the
    /// reserves it was priced against. `address(0)` means native MON.
    function quote(address tokenIn, address tokenOut, uint256 amountIn)
        external
        view
        returns (uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
    {
        address a = tokenIn == address(0) ? wrappedNative : tokenIn;
        address b = tokenOut == address(0) ? wrappedNative : tokenOut;
        (reserveIn, reserveOut) = _reserves(_pairFor(a, b), a);
        amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
    }

    /// @notice Uniswap v2's formula: 0.3% of the input stays in the pool.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256)
    {
        // Input checks, not comparisons of balances anyone can steer.
        // slither-disable-next-line incorrect-equality
        if (amountIn == 0) revert ZeroAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 inWithFee = amountIn * 997;
        return (inWithFee * reserveOut) / (reserveIn * 1_000 + inWithFee);
    }

    function _pairFor(address a, address b) internal view returns (address pair) {
        pair = factory.getPair(a, b);
        if (pair == address(0)) revert NoPair();
    }

    function _reserves(address pair, address tokenIn) internal view returns (uint256 reserveIn, uint256 reserveOut) {
        // The reserves are all a price needs; the last-update timestamp is not.
        // slither-disable-next-line unused-return
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        (reserveIn, reserveOut) = tokenIn == IUniswapV2Pair(pair).token0() ? (r0, r1) : (r1, r0);
    }

    /// @dev The input is already in the pair. What arrived is measured rather
    /// than assumed, so a token that takes a fee on transfer is priced on what
    /// the pair actually received.
    function _swap(address pair, address tokenIn, address tokenOut, address to)
        internal
        returns (uint256 amountOut)
    {
        (uint256 reserveIn, uint256 reserveOut) = _reserves(pair, tokenIn);
        uint256 received = IERC20(tokenIn).balanceOf(pair) - reserveIn;
        amountOut = getAmountOut(received, reserveIn, reserveOut);
        (uint256 out0, uint256 out1) =
            tokenOut == IUniswapV2Pair(pair).token0() ? (amountOut, uint256(0)) : (uint256(0), amountOut);
        IUniswapV2Pair(pair).swap(out0, out1, to, new bytes(0));
    }
}
