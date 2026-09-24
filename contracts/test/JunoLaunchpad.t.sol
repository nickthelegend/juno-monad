// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {JunoBase} from "./JunoBase.t.sol";
import {JunoLaunchpad} from "../src/JunoLaunchpad.sol";
import {JunoToken} from "../src/JunoToken.sol";
import {IJunoGraduator} from "../src/interfaces/IJunoGraduator.sol";
import {CurveMath} from "../src/libraries/CurveMath.sol";
import {MockPair} from "./mocks/MockUniswapV2.sol";

contract JunoLaunchpadTest is JunoBase {
    /* -------------------------------------------------------------- */
    /* Launch                                                         */
    /* -------------------------------------------------------------- */

    function test_launch_mintsFullSupplyAndLocksPair() public {
        address token = launchNative();
        JunoToken t = JunoToken(token);
        JunoLaunchpad.Pool memory p = launchpad.getPool(token);

        assertEq(t.totalSupply(), launchpad.TOTAL_SUPPLY());
        assertEq(t.balanceOf(address(launchpad)), launchpad.TOTAL_SUPPLY());
        assertEq(t.creator(), creator);
        assertEq(t.tokenURI(), "ipfs://bafkreigh2akiscaildc");
        assertEq(p.creator, creator);
        assertEq(p.venue, t.pair());
        assertTrue(p.venue != address(0), "pair created at launch");
        assertEq(p.sqrtPriceX96, MON_START);
        assertEq(p.quoteReserve, 0);
        assertGt(p.migrationQuoteThreshold, 0);
        // The builder targets 99% of supply for curve + migration; 1% is the buffer.
        assertApproxEqRel(p.baseReserve + p.migrationBase, 990_000_000 ether, 1e14);
        assertEq(p.baseReserve + p.migrationBase + p.leftover, launchpad.TOTAL_SUPPLY());
        assertEq(launchpad.tokenCount(), 1);
        assertEq(launchpad.tokens(0), token);
    }

    function test_launch_predictsAddress() public {
        JunoLaunchpad.LaunchParams memory lp = params(address(0), MON_START, contentWeights());
        address predicted = launchpad.predictToken(creator, lp.name, lp.symbol, lp.uri);
        vm.prank(creator);
        address token = launchpad.launch(lp, 0, 0);
        assertEq(token, predicted);

        // The next launch from the same creator lands somewhere new.
        address next = launchpad.predictToken(creator, lp.name, lp.symbol, lp.uri);
        assertTrue(next != token);
        vm.prank(creator);
        assertEq(launchpad.launch(lp, 0, 0), next);
    }

    function test_launch_withFirstBuy() public {
        JunoLaunchpad.LaunchParams memory lp = params(address(0), MON_START, contentWeights());
        vm.prank(creator);
        address token = launchpad.launch{value: 100 ether}(lp, 100 ether, 1);
        assertGt(JunoToken(token).balanceOf(creator), 0);
        assertGt(launchpad.getPool(token).quoteReserve, 0);
    }

    function test_launch_rejectsMsgValueWithoutFirstBuy() public {
        JunoLaunchpad.LaunchParams memory lp = params(address(0), MON_START, contentWeights());
        vm.prank(creator);
        vm.expectRevert(JunoLaunchpad.BadValue.selector);
        launchpad.launch{value: 1 ether}(lp, 0, 0);
    }

    /// A curve with no venue could fill and then neither trade nor graduate,
    /// holding everyone's quote for good. Refused at launch, before any buy.
    function test_launch_rejectsNoGraduator() public {
        vm.prank(owner);
        launchpad.setGraduator(IJunoGraduator(address(0)));
        JunoLaunchpad.LaunchParams memory lp = params(address(0), MON_START, contentWeights());
        vm.prank(creator);
        vm.expectRevert(JunoLaunchpad.NoGraduator.selector);
        launchpad.launch(lp, 0, 0);
    }

    function test_launch_rejectsUnknownQuote() public {
        JunoLaunchpad.LaunchParams memory lp = params(address(0xBEEF), MON_START, contentWeights());
        vm.prank(creator);
        vm.expectRevert(JunoLaunchpad.QuoteNotAllowed.selector);
        launchpad.launch(lp, 0, 0);
    }

    function test_launch_rejectsBadFees() public {
        JunoLaunchpad.LaunchParams memory lp = params(address(0), MON_START, contentWeights());
        lp.endFeeBps = 10; // below the 25 bps floor
        vm.prank(creator);
        vm.expectRevert(JunoLaunchpad.BadFees.selector);
        launchpad.launch(lp, 0, 0);

        lp = params(address(0), MON_START, contentWeights());
        lp.endFeeBps = lp.startFeeBps + 1;
        vm.prank(creator);
        vm.expectRevert(JunoLaunchpad.BadFees.selector);
        launchpad.launch(lp, 0, 0);
    }

    function test_launch_rejectsNonIncreasingCurve() public {
        JunoLaunchpad.LaunchParams memory lp = params(address(0), MON_START, contentWeights());
        lp.curve[5].sqrtPriceX96 = lp.curve[4].sqrtPriceX96;
        vm.prank(creator);
        vm.expectRevert(JunoLaunchpad.BadCurve.selector);
        launchpad.launch(lp, 0, 0);
    }

    function test_launch_rejectsZeroLiquidity() public {
        JunoLaunchpad.LaunchParams memory lp = params(address(0), MON_START, contentWeights());
        lp.curve[3].liquidity = 0;
        vm.prank(creator);
        vm.expectRevert(JunoLaunchpad.BadCurve.selector);
        launchpad.launch(lp, 0, 0);
    }

    function test_launch_rejectsOversizedCurve() public {
        JunoLaunchpad.LaunchParams memory lp = params(address(0), MON_START, contentWeights());
        for (uint256 i; i < 16; ++i) {
            lp.curve[i].liquidity = lp.curve[i].liquidity * 2;
        }
        vm.prank(creator);
        vm.expectPartialRevert(JunoLaunchpad.SupplyExceeded.selector);
        launchpad.launch(lp, 0, 0);
    }

    function test_launch_rejectsBadMetadata() public {
        JunoLaunchpad.LaunchParams memory lp = params(address(0), MON_START, contentWeights());
        lp.symbol = "";
        vm.prank(creator);
        vm.expectRevert(JunoLaunchpad.BadMetadata.selector);
        launchpad.launch(lp, 0, 0);
    }

    /* -------------------------------------------------------------- */
    /* Trading                                                        */
    /* -------------------------------------------------------------- */

    function test_buy_movesPriceAndAccruesFees() public {
        address token = launchNative();
        (uint256 out, uint256 paid) = buyNative(alice, token, 1_000 ether);
        JunoLaunchpad.Pool memory p = launchpad.getPool(token);

        assertEq(paid, 1_000 ether);
        assertEq(JunoToken(token).balanceOf(alice), out);
        assertGt(p.sqrtPriceX96, MON_START);
        // 9% launch fee, 20% of it to the protocol.
        uint256 fee = 90 ether;
        assertEq(p.quoteReserve, 1_000 ether - fee);
        assertEq(launchpad.protocolFees(address(0)), 18 ether);
        assertEq(p.creatorFees, 72 ether);
        assertEq(address(launchpad).balance, owed(token));
    }

    function test_buy_matchesQuote() public {
        address token = launchNative();
        (uint256 quotedOut, uint256 quotedPaid, uint256 fee,) = launchpad.quoteBuy(token, 2_500 ether);
        (uint256 out, uint256 paid) = buyNative(alice, token, 2_500 ether);
        assertEq(out, quotedOut);
        assertEq(paid, quotedPaid);
        assertGt(fee, 0);
    }

    function test_buy_emitsTrade() public {
        address token = launchNative();
        (uint256 quotedOut,,,) = launchpad.quoteBuy(token, 10 ether);
        vm.expectEmit(true, true, false, false, address(launchpad));
        emit JunoLaunchpad.Trade(token, alice, true, quotedOut, 10 ether, 0, 0, 0);
        buyNative(alice, token, 10 ether);
    }

    function test_buy_slippage() public {
        address token = launchNative();
        (uint256 quotedOut,,,) = launchpad.quoteBuy(token, 10 ether);
        vm.prank(alice);
        vm.expectPartialRevert(JunoLaunchpad.Slippage.selector);
        launchpad.buy{value: 10 ether}(token, 10 ether, quotedOut + 1, alice, block.timestamp);
    }

    function test_buy_deadline() public {
        address token = launchNative();
        vm.prank(alice);
        vm.expectRevert(JunoLaunchpad.Expired.selector);
        launchpad.buy{value: 1 ether}(token, 1 ether, 0, alice, block.timestamp - 1);
    }

    function test_buy_valueMustMatch() public {
        address token = launchNative();
        vm.prank(alice);
        vm.expectRevert(JunoLaunchpad.BadValue.selector);
        launchpad.buy{value: 1 ether}(token, 2 ether, 0, alice, block.timestamp);
    }

    function test_sell_roundTripLosesOnlyFees() public {
        address token = launchNative();
        vm.warp(block.timestamp + 1 hours); // resting fee: 1%
        uint256 before = alice.balance;
        buyNative(alice, token, 1_000 ether);
        sellAll(alice, token);
        uint256 lost = before - alice.balance;
        // Two 1% fees, and never a profit from rounding.
        assertGt(lost, 0);
        assertApproxEqRel(lost, 19.9 ether, 1e16);
        assertEq(JunoToken(token).balanceOf(alice), 0);
        assertEq(address(launchpad).balance, owed(token));
    }

    function test_sell_needsNoApproval() public {
        address token = launchNative();
        buyNative(alice, token, 10 ether);
        assertEq(JunoToken(token).allowance(alice, address(launchpad)), 0);
        uint256 out = sellAll(alice, token);
        assertGt(out, 0);
    }

    function test_sell_cannotGoBelowStart() public {
        address token = launchNative();
        buyNative(alice, token, 10 ether);
        uint256 balance = JunoToken(token).balanceOf(alice);
        // Bob has tokens only via transfer; the curve cannot pay out more than it took in.
        vm.prank(alice);
        JunoToken(token).transfer(bob, balance);
        buyNative(creator, token, 1 ether);
        uint256 creatorBalance = JunoToken(token).balanceOf(creator);
        vm.prank(creator);
        JunoToken(token).transfer(bob, creatorBalance);

        uint256 all = JunoToken(token).balanceOf(bob);
        vm.prank(bob);
        launchpad.sell(token, all, 0, bob, block.timestamp);
        // Back at the start, give or take the few wei of rounding that always favour the pool.
        assertApproxEqAbs(launchpad.getPool(token).sqrtPriceX96, MON_START, 16);
        assertGe(launchpad.getPool(token).sqrtPriceX96, MON_START);

        // Nothing left to sell into.
        buyNative(alice, token, 1 ether);
        uint256 more = JunoToken(token).balanceOf(alice) * 2;
        deal(token, alice, more);
        vm.prank(alice);
        vm.expectRevert(JunoLaunchpad.InsufficientLiquidity.selector);
        launchpad.sell(token, more, 0, alice, block.timestamp);
    }

    function test_fees_decayToRestingFee() public {
        address token = launchNative();
        assertEq(launchpad.currentFeePpm(token), 90_000);
        vm.warp(block.timestamp + 300);
        uint256 mid = launchpad.currentFeePpm(token);
        assertLt(mid, 90_000);
        assertGt(mid, 10_000);
        // Exponential: halfway through the decay is the geometric mean, 3%.
        assertApproxEqRel(mid, 30_000, 2e16);
        vm.warp(block.timestamp + 600);
        assertEq(launchpad.currentFeePpm(token), 10_000);
    }

    /* -------------------------------------------------------------- */
    /* Completion and graduation                                      */
    /* -------------------------------------------------------------- */

    function test_complete_partialFillRefunds() public {
        address token = launchNative();
        JunoLaunchpad.Pool memory p = launchpad.getPool(token);
        uint256 plenty = p.migrationQuoteThreshold * 2;

        uint256 before = alice.balance;
        (uint256 out, uint256 paid) = buyNative(alice, token, plenty);
        p = launchpad.getPool(token);

        assertTrue(p.complete);
        assertLt(paid, plenty);
        assertEq(before - alice.balance, paid, "unused quote came back");
        assertApproxEqAbs(p.baseReserve, 0, 1e6);
        assertApproxEqRel(out, launchpad.TOTAL_SUPPLY() - p.migrationBase - p.leftover, 1e12);
        assertApproxEqRel(p.quoteReserve, p.migrationQuoteThreshold, 1e12);
        assertEq(address(launchpad).balance, owed(token));

        vm.expectRevert(JunoLaunchpad.CurveComplete.selector);
        buyNative(bob, token, 1 ether);
        vm.prank(alice);
        vm.expectRevert(JunoLaunchpad.CurveComplete.selector);
        launchpad.sell(token, 1 ether, 0, alice, block.timestamp);
    }

    function test_pairLockedUntilGraduation() public {
        address token = launchNative();
        buyNative(alice, token, 10 ether);
        address pair = JunoToken(token).pair();
        vm.prank(alice);
        vm.expectRevert(JunoToken.PairLocked.selector);
        JunoToken(token).transfer(pair, 1);
    }

    function test_graduate_native() public {
        address token = launchNative();
        JunoLaunchpad.Pool memory p = launchpad.getPool(token);
        buyNative(alice, token, p.migrationQuoteThreshold * 2);

        address unfinished = launchNative();
        vm.expectRevert(JunoLaunchpad.CurveNotComplete.selector);
        launchpad.graduate(unfinished);

        p = launchpad.getPool(token);
        uint256 supplyBefore = JunoToken(token).totalSupply();
        (address venue, uint256 liquidity) = launchpad.graduate(token);
        JunoLaunchpad.Pool memory after_ = launchpad.getPool(token);

        assertEq(venue, p.venue);
        assertGt(liquidity, 0);
        assertTrue(after_.graduated);
        assertTrue(JunoToken(token).graduated());
        assertEq(MockPair(venue).balanceOf(graduator.LOCK()), liquidity, "LP locked");
        assertEq(JunoToken(token).balanceOf(address(launchpad)), 0, "nothing left behind");
        assertEq(JunoToken(token).totalSupply(), supplyBefore - p.baseReserve - p.leftover);
        assertEq(wmon.balanceOf(venue), p.quoteReserve);
        assertEq(address(launchpad).balance, owed(token), "fees stay claimable");

        // The AMM opens at the price the curve finished on.
        uint256 curveTop = (uint256(after_.sqrtPriceX96) * after_.sqrtPriceX96) >> 96;
        uint256 ammPrice = (wmon.balanceOf(venue) << 96) / JunoToken(token).balanceOf(venue);
        assertApproxEqRel(ammPrice, curveTop, 1e13);

        // And tokens now move freely into it.
        vm.prank(alice);
        JunoToken(token).transfer(venue, 1 ether);

        vm.expectRevert(JunoLaunchpad.AlreadyGraduated.selector);
        launchpad.graduate(token);
    }

    function test_graduate_survivesDonatedPair() public {
        address token = launchNative();
        JunoLaunchpad.Pool memory p = launchpad.getPool(token);
        // Someone creates the pair early and makes its reserves one-sided.
        address created = factory.createPair(token, address(wmon));
        assertEq(created, p.venue, "the pair lands where the token was locked");
        vm.deal(bob, 10 ether);
        vm.startPrank(bob);
        wmon.deposit{value: 5 ether}();
        wmon.transfer(p.venue, 5 ether);
        MockPair(p.venue).sync();
        vm.stopPrank();

        buyNative(alice, token, p.migrationQuoteThreshold * 2);
        (, uint256 liquidity) = launchpad.graduate(token);
        assertGt(liquidity, 0);
    }

    function test_launch_locksPairWithoutDeployingIt() public {
        address token = launchNative();
        address venue = launchpad.getPool(token).venue;
        assertEq(venue.code.length, 0, "no pair deployed at launch");
        assertEq(factory.getPair(token, address(wmon)), address(0));
        assertEq(JunoToken(token).pair(), venue);

        buyNative(alice, token, launchpad.getPool(token).migrationQuoteThreshold * 2);
        (address graduatedInto,) = launchpad.graduate(token);
        assertEq(graduatedInto, venue, "graduation deploys it exactly where it was locked");
        assertGt(venue.code.length, 0);
    }

    function test_graduate_usdc() public {
        address token = launchUsdc();
        JunoLaunchpad.Pool memory p = launchpad.getPool(token);
        vm.prank(alice);
        launchpad.buy(token, p.migrationQuoteThreshold * 2, 0, alice, block.timestamp);
        p = launchpad.getPool(token);
        assertTrue(p.complete);
        (address venue,) = launchpad.graduate(token);
        assertEq(usdc.balanceOf(venue), p.quoteReserve);
        assertEq(usdc.balanceOf(address(launchpad)), owed(token));
    }

    /* -------------------------------------------------------------- */
    /* Fee claims                                                     */
    /* -------------------------------------------------------------- */

    function test_claimCreatorFees() public {
        address token = launchNative();
        buyNative(alice, token, 100 ether);
        uint256 accrued = launchpad.getPool(token).creatorFees;
        assertGt(accrued, 0);

        vm.prank(alice);
        vm.expectRevert(JunoLaunchpad.NotCreator.selector);
        launchpad.claimCreatorFees(token, alice);

        uint256 before = creator.balance;
        vm.prank(creator);
        launchpad.claimCreatorFees(token, creator);
        assertEq(creator.balance - before, accrued);
        assertEq(launchpad.getPool(token).creatorFees, 0);
        assertEq(launchpad.getPool(token).creatorFeesClaimed, accrued);

        vm.prank(creator);
        vm.expectRevert(JunoLaunchpad.ZeroAmount.selector);
        launchpad.claimCreatorFees(token, creator);
    }

    function test_claimProtocolFees_onlyOwner() public {
        address token = launchNative();
        buyNative(alice, token, 100 ether);
        vm.prank(alice);
        vm.expectRevert();
        launchpad.claimProtocolFees(address(0), alice);

        uint256 accrued = launchpad.protocolFees(address(0));
        vm.prank(owner);
        launchpad.claimProtocolFees(address(0), owner);
        assertEq(owner.balance, accrued);
    }

    function test_protocolShareIsFixedAtLaunch() public {
        address token = launchNative();
        vm.prank(owner);
        launchpad.setProtocolShare(0);
        assertEq(launchpad.getPool(token).protocolShareBps, PROTOCOL_SHARE_BPS);
        vm.prank(owner);
        vm.expectRevert(JunoLaunchpad.BadFees.selector);
        launchpad.setProtocolShare(5_001);
    }

    /* -------------------------------------------------------------- */
    /* Presets                                                        */
    /* -------------------------------------------------------------- */

    /// @dev Front-loaded liquidity should absorb an opening order with less
    /// price movement than a back-loaded content curve.
    function test_thinNameIsDeeperAtTheOpen() public {
        vm.startPrank(creator);
        address content = launchpad.launch(params(address(0), MON_START, contentWeights()), 0, 0);
        address thin = launchpad.launch(params(address(0), MON_START, thinNameWeights()), 0, 0);
        vm.stopPrank();

        (,,, uint160 contentAfter) = launchpad.quoteBuy(content, 5_000 ether);
        (,,, uint160 thinAfter) = launchpad.quoteBuy(thin, 5_000 ether);
        assertLt(thinAfter, contentAfter);
    }

    /* -------------------------------------------------------------- */
    /* Fuzz                                                           */
    /* -------------------------------------------------------------- */

    function testFuzz_buyThenSellNeverProfits(uint256 amount, uint256 warp) public {
        address token = launchNative();
        amount = bound(amount, 1e9, launchpad.getPool(token).migrationQuoteThreshold / 2);
        warp = bound(warp, 0, 2 hours);
        vm.warp(block.timestamp + warp);

        uint256 before = alice.balance;
        buyNative(alice, token, amount);
        sellAll(alice, token);
        assertLe(alice.balance, before);
        assertEq(address(launchpad).balance, owed(token));
    }

    function testFuzz_splitBuysMatchOneBuy(uint256 amount, uint8 parts) public {
        address token = launchNative();
        vm.warp(block.timestamp + 1 hours);
        amount = bound(amount, 1 ether, launchpad.getPool(token).migrationQuoteThreshold / 2);
        parts = uint8(bound(parts, 2, 8));

        (uint256 single,,,) = launchpad.quoteBuy(token, amount);
        uint256 total;
        uint256 slice = amount / parts;
        for (uint256 i; i < parts; ++i) {
            (uint256 out,) = buyNative(alice, token, slice);
            total += out;
        }
        // Path independence up to rounding, which always favours the pool.
        assertLe(total, single);
        assertApproxEqRel(total, single, 1e15);
    }

    function testFuzz_sellsNeverDrainBelowOwed(uint256 a, uint256 b) public {
        address token = launchNative();
        uint256 cap = launchpad.getPool(token).migrationQuoteThreshold / 4;
        a = bound(a, 1e12, cap);
        b = bound(b, 1e12, cap);
        buyNative(alice, token, a);
        buyNative(bob, token, b);
        sellAll(alice, token);
        sellAll(bob, token);
        assertGe(address(launchpad).balance, owed(token));
        JunoLaunchpad.Pool memory p = launchpad.getPool(token);
        assertGe(p.sqrtPriceX96, MON_START);
    }
}

contract CurveMathTest is JunoBase {
    function testFuzz_quoteInThenBaseInReturnsToStart(uint128 liquidity, uint96 quoteIn) public pure {
        liquidity = uint128(bound(liquidity, 1e18, 1e30));
        quoteIn = uint96(bound(quoteIn, 1e6, 1e27));
        uint160 start = MON_START;
        uint160 up = CurveMath.nextSqrtPriceFromQuoteIn(start, liquidity, quoteIn);
        uint256 baseOut = CurveMath.baseDelta(start, up, liquidity, false);
        uint160 down = CurveMath.nextSqrtPriceFromBaseIn(up, liquidity, baseOut);
        // Selling back what was bought can never land below where it started.
        assertGe(down, start);
        uint256 quoteBack = CurveMath.quoteDelta(down, up, liquidity, false);
        assertLe(quoteBack, quoteIn);
    }

    function test_deltasAreSymmetric() public pure {
        uint160 a = MON_START;
        uint160 b = uint160((uint256(a) * 11) / 10);
        uint128 l = 1e24;
        assertEq(CurveMath.baseDelta(a, b, l, false), CurveMath.baseDelta(b, a, l, false));
        assertEq(CurveMath.quoteDelta(a, b, l, true), CurveMath.quoteDelta(b, a, l, true));
        assertGe(CurveMath.baseDelta(a, b, l, true), CurveMath.baseDelta(a, b, l, false));
    }
}
