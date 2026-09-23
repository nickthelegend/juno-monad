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
/// The pair is created at launch, not at graduation, so the token can refuse
/// transfers into it until the curve's reserves arrive. At graduation the
/// reserves are transferred in and `mint` is called directly — no router. The
/// router refuses to add liquidity to a pair whose reserves are one-sided,
/// and anyone can make them one-sided by donating quote and calling `sync`.
/// `mint` credits whatever arrived above the recorded reserves, so a donation
/// only ever nudges the opening price in the curve's favour at the donor's
/// expense; it cannot stop graduation.
///
/// A native-MON curve graduates into a WMON pair.
contract UniswapV2Graduator is IJunoGraduator {
    using SafeERC20 for IERC20;

    /// @notice LP tokens minted here can never be burned, so the liquidity is permanent.
    address public constant LOCK = 0x000000000000000000000000000000000000dEaD;

    address public immutable launchpad;
    IUniswapV2Factory public immutable factory;
    address public immutable wrappedNative;

    error OnlyLaunchpad();
    error BadValue();

    constructor(address launchpad_, IUniswapV2Factory factory_, address wrappedNative_) {
        launchpad = launchpad_;
        factory = factory_;
        wrappedNative = wrappedNative_;
    }

    modifier onlyLaunchpad() {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        _;
    }

    function prepare(address token, address quote) external onlyLaunchpad returns (address pair) {
        address q = quote == address(0) ? wrappedNative : quote;
        pair = factory.getPair(token, q);
        if (pair == address(0)) pair = factory.createPair(token, q);
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

        IERC20(token).safeTransfer(pair, baseAmount);
        IERC20(q).safeTransfer(pair, quoteAmount);
        liquidity = IUniswapV2Pair(pair).mint(LOCK);
    }
}
