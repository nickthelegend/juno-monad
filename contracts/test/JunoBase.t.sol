// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {JunoLaunchpad} from "../src/JunoLaunchpad.sol";
import {JunoToken} from "../src/JunoToken.sol";
import {CurveMath} from "../src/libraries/CurveMath.sol";
import {UniswapV2Graduator} from "../src/graduators/UniswapV2Graduator.sol";
import {IUniswapV2Factory} from "../src/interfaces/IUniswapV2.sol";
import {MockFactory, MockWMON, MockStable} from "./mocks/MockUniswapV2.sol";

/// @dev Shared fixtures: a launchpad wired to a mock Uniswap v2, and a curve
/// builder that mirrors `lib/juno/curves.ts` — geometric sqrt prices, sixteen
/// liquidity weights, liquidity scaled so the curve plus its migration reserve
/// fill 99% of supply and the last 1% is the rounding buffer.
abstract contract JunoBase is Test {
    JunoLaunchpad internal launchpad;
    UniswapV2Graduator internal graduator;
    MockFactory internal factory;
    MockWMON internal wmon;
    MockStable internal usdc;

    address internal owner = makeAddr("owner");
    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint16 internal constant PROTOCOL_SHARE_BPS = 2_000;

    /// @dev ~$1k FDV at MON = $0.025, 18-decimal quote.
    uint160 internal constant MON_START = 500_000_000_000_000_000_000_000_000; // 5e26
    /// @dev $1k FDV in 6-decimal USDC against an 18-decimal base.
    uint160 internal constant USDC_START = 79_228_162_514_264_337_593; // ~sqrt(1e-18) in Q96
    /// @dev 25x in price over sixteen ranges: 5x in sqrt price, 5^(1/16) ≈ 1.1058 per range.
    uint256 internal constant STEP_NUM = 11_058;
    uint256 internal constant STEP_DEN = 10_000;

    function setUp() public virtual {
        factory = new MockFactory();
        wmon = new MockWMON();
        usdc = new MockStable();

        vm.startPrank(owner);
        launchpad = new JunoLaunchpad(owner, PROTOCOL_SHARE_BPS);
        graduator = new UniswapV2Graduator(address(launchpad), IUniswapV2Factory(address(factory)), address(wmon));
        launchpad.setGraduator(graduator);
        launchpad.setQuoteAllowed(address(usdc), true);
        vm.stopPrank();

        vm.deal(alice, 10_000_000 ether);
        vm.deal(bob, 10_000_000 ether);
        vm.deal(creator, 10_000_000 ether);
        usdc.mint(alice, 10_000_000e6);
        usdc.mint(bob, 10_000_000e6);
        vm.prank(alice);
        usdc.approve(address(launchpad), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(launchpad), type(uint256).max);
    }

    /* -------------------------------------------------------------- */
    /* Curve builders                                                 */
    /* -------------------------------------------------------------- */

    function contentWeights() internal pure returns (uint256[16] memory w) {
        uint256 value = 1e6;
        for (uint256 i; i < 16; ++i) {
            w[i] = value;
            value = (value * 12) / 10;
        }
    }

    function thinNameWeights() internal pure returns (uint256[16] memory w) {
        uint256 value = 1e6;
        for (uint256 i; i < 16; ++i) {
            w[i] = value;
            value = (value * 82) / 100;
        }
    }

    function uniformWeights() internal pure returns (uint256[16] memory w) {
        for (uint256 i; i < 16; ++i) {
            w[i] = 1e6;
        }
    }

    function buildCurve(uint160 sqrtStart, uint256[16] memory weights)
        internal
        pure
        returns (JunoLaunchpad.Segment[16] memory curve)
    {
        uint160[17] memory s;
        s[0] = sqrtStart;
        for (uint256 i; i < 16; ++i) {
            s[i + 1] = uint160((uint256(s[i]) * STEP_NUM) / STEP_DEN);
        }

        // Everything is linear in liquidity, so size one unit and scale.
        uint256 unit = 1e12;
        uint256 base;
        uint256 quote;
        for (uint256 i; i < 16; ++i) {
            uint128 l = uint128(weights[i] * unit);
            base += CurveMath.baseDelta(s[i], s[i + 1], l, true);
            quote += CurveMath.quoteDelta(s[i], s[i + 1], l, true);
        }
        uint256 total = base + CurveMath.baseForQuoteAt(quote, s[16]);
        uint256 target = (990_000_000 ether);

        for (uint256 i; i < 16; ++i) {
            uint256 l = (weights[i] * unit * target) / total;
            curve[i] = JunoLaunchpad.Segment({sqrtPriceX96: s[i + 1], liquidity: uint128(l)});
        }
    }

    function params(address quote, uint160 sqrtStart, uint256[16] memory weights)
        internal
        pure
        returns (JunoLaunchpad.LaunchParams memory p)
    {
        p.name = "Seahorse Valley";
        p.symbol = "SEAHORSE";
        p.uri = "ipfs://bafkreigh2akiscaildc";
        p.quote = quote;
        p.preset = 0;
        p.sqrtStartPriceX96 = sqrtStart;
        p.curve = buildCurve(sqrtStart, weights);
        p.startFeeBps = 900;
        p.endFeeBps = 100;
        p.feeDecaySeconds = 600;
        // (100/900)^(1/60) ≈ 0.96404 per period → decay ≈ 0.03596
        p.feeDecayWad = 35_960_000_000_000_000;
    }

    function launchNative() internal returns (address token) {
        vm.prank(creator);
        token = launchpad.launch(params(address(0), MON_START, contentWeights()), 0, 0);
    }

    function launchUsdc() internal returns (address token) {
        vm.prank(creator);
        token = launchpad.launch(params(address(usdc), USDC_START, contentWeights()), 0, 0);
    }

    function buyNative(address who, address token, uint256 amount) internal returns (uint256 out, uint256 paid) {
        vm.prank(who);
        return launchpad.buy{value: amount}(token, amount, 0, who, block.timestamp);
    }

    function sellAll(address who, address token) internal returns (uint256 out) {
        uint256 balance = JunoToken(token).balanceOf(who);
        vm.prank(who);
        return launchpad.sell(token, balance, 0, who, block.timestamp);
    }

    /// @dev Quote a pool holds plus the fees it owes, for the solvency check.
    function owed(address token) internal view returns (uint256) {
        JunoLaunchpad.Pool memory p = launchpad.getPool(token);
        return p.quoteReserve + p.creatorFees + launchpad.protocolFees(p.quote);
    }
}
