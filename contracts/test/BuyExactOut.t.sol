// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {JunoBase} from "./JunoBase.t.sol";
import {JunoLaunchpad} from "../src/JunoLaunchpad.sol";
import {JunoToken} from "../src/JunoToken.sol";

/// Exact-out buys: the trader names the tokens, the curve names the price.
contract BuyExactOutTest is JunoBase {
    uint256 internal constant ONE_MILLION = 1_000_000 ether;

    function _buyExactOut(address who, address token, uint256 baseOut, uint256 max)
        internal
        returns (uint256 paid)
    {
        vm.prank(who);
        return launchpad.buyExactOut{value: max}(token, baseOut, max, who, block.timestamp);
    }

    function test_buyExactOut_deliversExactlyAndRefundsTheRest() public {
        address token = launchNative();
        (uint256 cost,,) = launchpad.quoteBuyExactOut(token, ONE_MILLION);
        uint256 before = alice.balance;

        uint256 paid = _buyExactOut(alice, token, ONE_MILLION, cost * 2);

        assertEq(JunoToken(token).balanceOf(alice), ONE_MILLION, "exactly the tokens asked for");
        assertEq(paid, cost, "the quoted cost");
        assertEq(before - alice.balance, cost, "the excess came back");
        assertEq(address(launchpad).balance, owed(token), "solvent");
    }

    function test_buyExactOut_chargesTheSameFeeRateAsExactIn() public {
        address token = launchNative();
        (uint256 cost, uint256 fee,) = launchpad.quoteBuyExactOut(token, ONE_MILLION);
        // 9% launch fee on the gross.
        assertApproxEqRel(fee, (cost * 9) / 100, 1e12);
        _buyExactOut(alice, token, ONE_MILLION, cost);
        JunoLaunchpad.Pool memory p = launchpad.getPool(token);
        assertEq(p.quoteReserve, cost - fee);
        assertEq(p.creatorFees + launchpad.protocolFees(address(0)), fee);
    }

    function test_buyExactOut_revertsAboveTheCap() public {
        address token = launchNative();
        (uint256 cost,,) = launchpad.quoteBuyExactOut(token, ONE_MILLION);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(JunoLaunchpad.ExceedsMax.selector, cost, cost - 1));
        launchpad.buyExactOut{value: cost - 1}(token, ONE_MILLION, cost - 1, alice, block.timestamp);
    }

    function test_buyExactOut_valueMustMatchTheCap() public {
        address token = launchNative();
        (uint256 cost,,) = launchpad.quoteBuyExactOut(token, ONE_MILLION);
        vm.prank(alice);
        vm.expectRevert(JunoLaunchpad.BadValue.selector);
        launchpad.buyExactOut{value: cost}(token, ONE_MILLION, cost * 2, alice, block.timestamp);
    }

    function test_buyExactOut_refusesMoreThanTheCurveHolds() public {
        address token = launchNative();
        uint256 all = launchpad.getPool(token).baseReserve;
        vm.expectRevert(JunoLaunchpad.InsufficientLiquidity.selector);
        launchpad.quoteBuyExactOut(token, all + 1);
    }

    function test_buyExactOut_zeroAndDeadline() public {
        address token = launchNative();
        vm.prank(alice);
        vm.expectRevert(JunoLaunchpad.ZeroAmount.selector);
        launchpad.buyExactOut{value: 1 ether}(token, 0, 1 ether, alice, block.timestamp);
        vm.prank(alice);
        vm.expectRevert(JunoLaunchpad.Expired.selector);
        launchpad.buyExactOut{value: 1 ether}(token, ONE_MILLION, 1 ether, alice, block.timestamp - 1);
    }

    function test_buyExactOut_usdcPullsOnlyTheCost() public {
        address token = launchUsdc();
        (uint256 cost,,) = launchpad.quoteBuyExactOut(token, ONE_MILLION);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 paid = launchpad.buyExactOut(token, ONE_MILLION, cost * 3, alice, block.timestamp);
        assertEq(paid, cost);
        assertEq(before - usdc.balanceOf(alice), cost);
        assertEq(JunoToken(token).balanceOf(alice), ONE_MILLION);
        assertEq(usdc.balanceOf(address(launchpad)), owed(token), "solvent");
    }

    function test_buyExactOut_stepsUpTheCurve() public {
        address token = launchNative();
        buyNative(bob, token, 200_000 ether);
        JunoLaunchpad.Pool memory p = launchpad.getPool(token);
        // Walk the rest in exact-out steps; each one delivers what was asked.
        uint256 step = p.baseReserve / 4;
        for (uint256 i; i < 3; ++i) {
            (uint256 cost,,) = launchpad.quoteBuyExactOut(token, step);
            _buyExactOut(alice, token, step, cost);
        }
        assertEq(JunoToken(token).balanceOf(alice), step * 3);
        assertEq(address(launchpad).balance, owed(token), "solvent");
        assertFalse(launchpad.getPool(token).complete);
    }

    /// The largest exact-out the curve accepts takes it to its top and
    /// completes it, exactly as an exact-in buy that reaches the top does.
    function test_buyExactOut_largestSizeCompletesTheCurve() public {
        address token = launchNative();
        uint256 lo = 0;
        uint256 hi = launchpad.getPool(token).baseReserve;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            try launchpad.quoteBuyExactOut(token, mid) {
                lo = mid;
            } catch {
                hi = mid - 1;
            }
        }
        (uint256 cost,,) = launchpad.quoteBuyExactOut(token, lo);
        vm.deal(alice, cost);
        _buyExactOut(alice, token, lo, cost);
        JunoLaunchpad.Pool memory p = launchpad.getPool(token);
        assertTrue(p.complete, "the curve completed");
        assertEq(JunoToken(token).balanceOf(alice), lo);
        assertEq(address(launchpad).balance, owed(token), "solvent");
        // And it graduates like any completed curve.
        launchpad.graduate(token);
        assertTrue(launchpad.getPool(token).graduated);
    }

    /// Exact-out and exact-in agree: paying what exact-out charged, an exact-in
    /// buy from the same state gets at least nearly as many tokens — exact-out
    /// never charges a premium beyond rounding.
    function testFuzz_exactOutCostsWhatExactInWouldCharge(uint256 baseOut, uint256 warmup) public {
        address token = launchNative();
        warmup = bound(warmup, 0, 150_000 ether);
        if (warmup >= 1 ether) buyNative(bob, token, warmup);
        uint256 available = launchpad.getPool(token).baseReserve;
        baseOut = bound(baseOut, 1 ether, available / 2);

        (uint256 cost,,) = launchpad.quoteBuyExactOut(token, baseOut);
        (uint256 inOut,,,) = launchpad.quoteBuy(token, cost);
        // The same quote buys at least what exact-out delivers, give or take
        // rounding in the pool's favour on both paths.
        assertGe(inOut + 1e6, baseOut, "exact-in with the same quote buys at least as much");
        assertApproxEqRel(inOut, baseOut, 1e10, "and not meaningfully more");

        uint256 paid = _buyExactOut(alice, token, baseOut, cost);
        assertEq(paid, cost);
        assertEq(JunoToken(token).balanceOf(alice), baseOut);
        assertEq(address(launchpad).balance, owed(token), "solvent");
    }

    /// Whatever exact-out buys, selling it all back returns no more than was paid.
    function testFuzz_exactOutRoundTripNeverProfits(uint256 baseOut) public {
        address token = launchNative();
        baseOut = bound(baseOut, 1 ether, launchpad.getPool(token).baseReserve / 2);
        (uint256 cost,,) = launchpad.quoteBuyExactOut(token, baseOut);
        _buyExactOut(alice, token, baseOut, cost);
        uint256 back = sellAll(alice, token);
        assertLe(back, cost);
        assertEq(address(launchpad).balance, owed(token), "solvent");
    }
}
