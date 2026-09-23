// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IJunoGraduator} from "../interfaces/IJunoGraduator.sol";
import {IUniswapV2Factory, IUniswapV2Pair, IWrappedNative} from "../interfaces/IUniswapV2.sol";

/// @title UniswapV2Graduator
/// @notice Graduates a completed Juno curve into a Uniswap v2 pair and locks
/// the liquidity by minting it to the dead address.
///
/// The pair's address is fixed at launch, so the token can refuse transfers
/// into it until the curve's reserves arrive — but the pair itself is only
/// deployed at graduation. A v2 pair lives at a CREATE2 address derived from
/// the factory, the two tokens and the pair's init code hash, so it can be
/// locked before it exists. Deploying it up front cost every launch about
/// 2.2M gas for a pair most posts never reach; now only a graduation pays.
///
/// At graduation the reserves are transferred in and `mint` is called directly
/// — no router. The router refuses to add liquidity to a pair whose reserves
/// are one-sided, and anyone can make them one-sided by creating the pair
/// early, donating quote and calling `sync`. `mint` credits whatever arrived
/// above the recorded reserves, so a donation only ever nudges the opening
/// price in the curve's favour at the donor's expense; it cannot stop
/// graduation.
///
/// A native-MON curve graduates into a WMON pair.
contract UniswapV2Graduator is IJunoGraduator {
    using SafeERC20 for IERC20;

    /// @notice LP tokens minted here can never be burned, so the liquidity is permanent.
    address public constant LOCK = 0x000000000000000000000000000000000000dEaD;

    address public immutable launchpad;
    IUniswapV2Factory public immutable factory;
    address public immutable wrappedNative;
    /// @notice keccak256 of the factory's pair creation code. Uniswap's own
    /// deployments share 0x96e8ac42…845f; a factory built from source differs.
    bytes32 public immutable pairInitCodeHash;

    error OnlyLaunchpad();
    error BadValue();
    /// @dev The factory created the pair somewhere other than the address the
    /// token was locked against — the init code hash is wrong for this
    /// factory. Graduating anyway would seed an unlocked pair.
    error PairMismatch(address expected, address actual);

    constructor(address launchpad_, IUniswapV2Factory factory_, address wrappedNative_, bytes32 pairInitCodeHash_) {
        launchpad = launchpad_;
        factory = factory_;
        wrappedNative = wrappedNative_;
        pairInitCodeHash = pairInitCodeHash_;
    }

    modifier onlyLaunchpad() {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        _;
    }

    /// @notice Where the pair for `token`/`quote` is, or will be.
    function pairFor(address token, address quote) public view returns (address) {
        address q = quote == address(0) ? wrappedNative : quote;
        (address token0, address token1) = token < q ? (token, q) : (q, token);
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        return address(
            uint160(uint256(keccak256(abi.encodePacked(hex"ff", address(factory), salt, pairInitCodeHash))))
        );
    }

    function prepare(address token, address quote) external view onlyLaunchpad returns (address) {
        return pairFor(token, quote);
    }

    function graduate(address token, address quote, uint256 baseAmount, uint256 quoteAmount)
        external
        payable
        onlyLaunchpad
        returns (address pair, uint256 liquidity)
    {
        address q = quote;
        if (quote == address(0)) {
            if (msg.value != quoteAmount) revert BadValue();
            IWrappedNative(wrappedNative).deposit{value: quoteAmount}();
            q = wrappedNative;
        } else if (msg.value != 0) {
            revert BadValue();
        }

        pair = factory.getPair(token, q);
        if (pair == address(0)) pair = factory.createPair(token, q);
        address expected = pairFor(token, q);
        if (pair != expected) revert PairMismatch(expected, pair);

        IERC20(token).safeTransfer(pair, baseAmount);
        IERC20(q).safeTransfer(pair, quoteAmount);
        liquidity = IUniswapV2Pair(pair).mint(LOCK);
    }
}
