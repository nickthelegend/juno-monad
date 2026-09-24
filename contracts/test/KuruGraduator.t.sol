// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {JunoBase} from "./JunoBase.t.sol";
import {JunoLaunchpad} from "../src/JunoLaunchpad.sol";
import {JunoToken} from "../src/JunoToken.sol";
import {KuruGraduator} from "../src/graduators/KuruGraduator.sol";
import {IJunoGraduator} from "../src/interfaces/IJunoGraduator.sol";
import {IKuruMarginAccount, IKuruOrderBook, IKuruRouter, IKuruVault} from "../src/interfaces/IKuru.sol";

/// @dev The parameter maths, checked against Kuru's own worked example.
contract KuruMarketParamsTest is Test {
    KuruGraduator internal g = new KuruGraduator(address(this), IKuruRouter(address(0)), address(0));

    /// Kuru's SDK, for 1,000 MON against 200M tokens (5e-6 MON), picks
    /// pricePrecision 1e8, tick 5, sizePrecision 1e8, maxSize 1e14. Juno keeps
    /// all but the tick, which is one unit (0.2% here) so orders can rest
    /// inside the vault's 1% spread.
    function test_matchesKuruSdkExample() public view {
        KuruGraduator.MarketParams memory m = g.marketParams(200_000_000 ether, 1_000 ether);
        assertEq(m.pricePrecision, 1e8);
        assertEq(m.tickSize, 1);
        assertEq(m.sizePrecision, 1e8);
        assertEq(m.maxSize, 1e14);
        // 100 tokens ≈ 0.0005 MON: the round number under 0.001 MON.
        assertEq(m.minSize, 100 * 1e8);
    }

    function test_threeSignificantDigits(uint256 base, uint256 quote) public view {
        base = bound(base, 1_000_000 ether, 1_000_000_000 ether);
        quote = bound(quote, 1 ether, 10_000_000 ether);
        uint256 priceWad = (quote * 1e18) / base;
        vm.assume(priceWad >= 1e10); // 1e-8 MON and up
        KuruGraduator.MarketParams memory m = g.marketParams(base, quote);

        uint256 priceInt = (priceWad * m.pricePrecision) / 1e18;
        if (m.pricePrecision < 1e9) {
            assertGe(priceInt, 100, "three digits");
            assertLe(uint256(m.tickSize) * 100, priceInt, "tick at most 1%");
            assertGe(uint256(m.tickSize) * 1_000, priceInt, "tick at least 0.1%");
        } else {
            // Kuru's finest precision: under 1e-7 MON the price keeps two digits.
            assertGe(priceInt, 10);
        }
        if (m.pricePrecision > 1 && m.pricePrecision < 1e9) assertLt(priceInt, 1_000, "smallest precision");
        assertGe(m.tickSize, 1);
        // Kuru's order bound: an order's quote, in price units, fits a uint32.
        assertLe(uint256(m.maxSize) * priceInt / m.sizePrecision, type(uint32).max);
        assertGt(
            uint256(m.maxSize) * priceInt * 10 / m.sizePrecision,
            type(uint32).max / 10,
            "largest power of ten"
        );
        assertLe(m.minSize, m.maxSize);
    }

    function test_refusesUnquotablePrices() public {
        // 1e-9 MON: a tick would be the whole price.
        vm.expectRevert(abi.encodeWithSelector(KuruGraduator.PriceOutOfRange.selector, 1e9));
        g.marketParams(1_000_000_000 ether, 1 ether);
        // 10M MON per token: nowhere left to go up.
        vm.expectRevert(abi.encodeWithSelector(KuruGraduator.PriceOutOfRange.selector, 1e25));
        g.marketParams(1 ether, 10_000_000 ether);
    }
}

/// @dev End to end against Kuru's contracts on a Monad testnet fork: launch a
/// post that chose Kuru, fill its curve, graduate, and trade the new market.
/// Opt-in, because it needs an RPC:
///
///   KURU_FORK_TEST=1 forge test --match-contract KuruGraduatorForkTest
///
/// `KURU_FORK_RPC` picks the RPC (default: Monad's public testnet one) and
/// `KURU_FORK_BLOCK` pins a block, which Foundry then caches between runs.
/// The public RPC rate-limits, so run it with `--threads 1`.
contract KuruGraduatorForkTest is JunoBase {
    IKuruRouter internal constant ROUTER = IKuruRouter(0x7EFbE105Ca7415dE98F96622173458ac1c054630);
    IKuruMarginAccount internal constant MARGIN =
        IKuruMarginAccount(0xd029C2D98ff85D8F64799017fE00a59B1159CE02);

    KuruGraduator internal kuru;

    function setUp() public override {
        if (!vm.envOr("KURU_FORK_TEST", false)) {
            vm.skip(true);
            return;
        }
        string memory rpc = vm.envOr("KURU_FORK_RPC", string("https://testnet-rpc.monad.xyz"));
        // Pinning a block lets Foundry cache what it fetches between runs.
        uint256 blockNumber = vm.envOr("KURU_FORK_BLOCK", uint256(0));
        if (blockNumber == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, blockNumber);
        assertEq(block.chainid, 10143, "Monad testnet");
        super.setUp();

        kuru = new KuruGraduator(address(launchpad), ROUTER, address(MARGIN));
        vm.prank(owner);
        launchpad.setGraduatorAllowed(kuru, true);
    }

    function launchOnKuru() internal returns (address token) {
        JunoLaunchpad.LaunchParams memory lp = params(address(0), MON_START, contentWeights());
        lp.graduator = address(kuru);
        vm.prank(creator);
        token = launchpad.launch(lp, 0, 0);
    }

    function fillAndGraduate(address token) internal returns (address market, uint256 shares) {
        buyNative(alice, token, launchpad.getPool(token).migrationQuoteThreshold * 2);
        assertTrue(launchpad.getPool(token).complete);
        return launchpad.graduate(token);
    }

    function test_launch_locksKuruUntilGraduation() public {
        address token = launchOnKuru();
        JunoLaunchpad.Pool memory p = launchpad.getPool(token);
        assertEq(p.graduator, address(kuru));
        assertEq(p.venue, address(MARGIN), "locks Kuru's MarginAccount");
        assertEq(JunoToken(token).pair(), address(MARGIN));

        // Nobody can put the token into Kuru before the curve fills: every
        // order, deposit and vault seed goes through the MarginAccount.
        buyNative(alice, token, 10 ether);
        vm.startPrank(alice);
        JunoToken(token).approve(address(MARGIN), type(uint256).max);
        vm.expectRevert();
        MARGIN.deposit(alice, token, 1 ether);
        vm.stopPrank();
    }

    function test_graduate_opensKuruMarketAtCurvePrice() public {
        address token = launchOnKuru();
        (address market, uint256 shares) = fillAndGraduate(token);
        JunoLaunchpad.Pool memory p = launchpad.getPool(token);

        assertTrue(p.graduated);
        assertGt(shares, 0);
        (uint32 pricePrecision,, address base,,,,,,,,) = ROUTER.verifiedMarket(market);
        assertEq(base, token, "a market the Router registered");
        assertEq(kuru.marketOf(token), market);
        assertGt(pricePrecision, 0);

        (address vault,,,,,,,) = IKuruOrderBook(market).getVaultParams();
        assertEq(IERC20Like(vault).balanceOf(kuru.LOCK()), shares, "LP shares locked for good");
        assertEq(JunoToken(token).balanceOf(address(kuru)), 0, "graduator keeps nothing");
        assertEq(address(kuru).balance, 0);

        // The book opens where the curve finished: ask at the curve top, bid one spread below.
        uint256 curveTopWad = (uint256(p.sqrtPriceX96) * p.sqrtPriceX96 * 1e18) >> 192;
        (uint256 bid, uint256 ask) = IKuruOrderBook(market).bestBidAsk();
        assertApproxEqRel(ask, curveTopWad, 0.02e18, "ask at the curve top");
        assertLt(bid, ask);
        assertApproxEqRel(bid, (ask * 100) / 101, 0.02e18, "1% spread");

        // And the token now moves into Kuru freely.
        vm.startPrank(alice);
        JunoToken(token).approve(address(MARGIN), type(uint256).max);
        MARGIN.deposit(alice, token, 1 ether);
        vm.stopPrank();
        assertEq(MARGIN.getBalance(alice, token), 1 ether);
    }

    function test_trade_marketBuyAndSellOnKuru() public {
        address token = launchOnKuru();
        (address market,) = fillAndGraduate(token);
        (uint32 pricePrecision, uint96 sizePrecision,,,,,,,,,) = ROUTER.verifiedMarket(market);
        (, uint256 ask) = IKuruOrderBook(market).bestBidAsk();

        // Quote first, the way the app does: an eth_call from address(0) matches without moving funds.
        uint96 quoteSize = uint96(1 * uint256(pricePrecision)); // 1 MON
        vm.prank(address(0));
        uint256 quoted = IKuruOrderBook(market).placeAndExecuteMarketBuy(quoteSize, 0, false, false);
        assertGt(quoted, 0);

        uint256 before = JunoToken(token).balanceOf(bob);
        vm.prank(bob);
        IKuruOrderBook(market).placeAndExecuteMarketBuy{value: 1 ether}(
            quoteSize, (quoted * 99) / 100, false, false
        );
        uint256 got = JunoToken(token).balanceOf(bob) - before;
        assertApproxEqRel(got, quoted, 0.001e18, "fill matches the quote");
        // ~1 MON at the ask, less the 0.3% taker fee.
        assertApproxEqRel(got, (1e36 / ask) * 997 / 1000, 0.02e18);

        // Sell half back.
        uint256 sellWei = got / 2;
        uint96 size = uint96((sellWei * sizePrecision) / 1e18);
        vm.prank(address(0));
        uint256 quotedMon = IKuruOrderBook(market).placeAndExecuteMarketSell(size, 0, false, false);
        uint256 monBefore = bob.balance;
        vm.startPrank(bob);
        JunoToken(token).approve(market, type(uint256).max);
        IKuruOrderBook(market).placeAndExecuteMarketSell(size, (quotedMon * 99) / 100, false, false);
        vm.stopPrank();
        uint256 monGot = bob.balance - monBefore;
        assertApproxEqRel(monGot, quotedMon, 0.001e18);
        // Half the tokens back for a little under half a MON: two fees and the spread.
        assertGt(monGot, 0.47 ether);
        assertLt(monGot, 0.5 ether);
    }

    function test_trade_largeOrderAgainstTheVault() public {
        address token = launchOnKuru();
        (address market,) = fillAndGraduate(token);
        (uint32 pricePrecision,,,,,,,, uint96 maxSize,,) = ROUTER.verifiedMarket(market);
        (, uint256 ask) = IKuruOrderBook(market).bestBidAsk();
        // A buy several times larger than the book's biggest limit order.
        uint256 notional = (uint256(maxSize) * ask) / 1e18 * 5;
        notional = notional < 100 ether ? 100 ether : notional;
        uint96 quoteSize = uint96((notional * pricePrecision) / 1e18);
        vm.deal(bob, notional * 2);
        vm.prank(bob);
        uint256 got =
            IKuruOrderBook(market).placeAndExecuteMarketBuy{value: notional}(quoteSize, 1, false, false);
        assertGt(got, 0);
        emit log_named_decimal_uint("MON spent", notional, 18);
        emit log_named_decimal_uint("tokens received", got, 18);
    }

    /// A resting bid inside the vault's spread fills first, credits the
    /// buyer's MarginAccount, and withdraws to the wallet. A second bid is
    /// cancelled and its MON comes back the same way.
    function test_limitOrders_restFillCancelWithdraw() public {
        address token = launchOnKuru();
        (address market,) = fillAndGraduate(token);
        (uint32 pricePrecision, uint96 sizePrecision,,,,, uint32 tickSize,,,,) = ROUTER.verifiedMarket(market);
        (uint256 bidWad, uint256 askWad) = IKuruOrderBook(market).bestBidAsk();

        // Bob bids halfway between the vault's bid and ask — inside its spread.
        uint256 midInt = ((bidWad + askWad) / 2) * pricePrecision / 1e18;
        uint32 price = uint32((midInt / tickSize) * tickSize);
        uint96 size = uint96(1_000 * uint256(sizePrecision)); // 1,000 tokens
        uint256 lockedWei = (uint256(size) * price * 1e18) / (uint256(sizePrecision) * pricePrecision);

        vm.startPrank(bob);
        MARGIN.deposit{value: lockedWei + 1 ether}(bob, address(0), lockedWei + 1 ether);
        vm.recordLogs();
        IKuruOrderBook(market).addBuyOrder(price, size, true);
        vm.stopPrank();
        uint40 orderId = uint40(IKuruOrderBook(market).s_orderIdCounter());
        (address owner_, uint96 left,,,, uint32 restingAt,, bool isBuy) =
            IKuruOrderBook(market).s_orders(orderId);
        assertEq(owner_, bob);
        assertEq(left, size);
        assertEq(restingAt, price);
        assertTrue(isBuy);
        (uint256 bestBid,) = IKuruOrderBook(market).bestBidAsk();
        assertGt(uint256(price) * 1e18 / pricePrecision, bidWad, "inside the vault's spread");
        assertEq(bestBid, uint256(price) * 1e18 / pricePrecision, "bob's bid is the best bid");

        // Alice market-sells 1,000 tokens: bob's bid takes all of it.
        vm.startPrank(alice);
        JunoToken(token).approve(market, type(uint256).max);
        IKuruOrderBook(market).placeAndExecuteMarketSell(size, 0, false, false);
        vm.stopPrank();
        (, left,,,,,,) = IKuruOrderBook(market).s_orders(orderId);
        assertEq(left, 0, "filled");
        assertEq(MARGIN.getBalance(bob, token), 1_000 ether, "fills land in bob's MarginAccount");

        // Withdraw the tokens to the wallet.
        address[] memory tokens = new address[](1);
        tokens[0] = token;
        uint256 before = JunoToken(token).balanceOf(bob);
        vm.prank(bob);
        MARGIN.batchWithdrawMaxTokens(tokens);
        assertEq(JunoToken(token).balanceOf(bob) - before, 1_000 ether);

        // A second bid, cancelled: the MON is back in the MarginAccount.
        uint256 marginBefore = MARGIN.getBalance(bob, address(0));
        vm.prank(bob);
        IKuruOrderBook(market).addBuyOrder(price, size, true);
        uint40 second = uint40(IKuruOrderBook(market).s_orderIdCounter());
        assertLt(MARGIN.getBalance(bob, address(0)), marginBefore);
        uint40[] memory ids = new uint40[](1);
        ids[0] = second;
        vm.prank(bob);
        IKuruOrderBook(market).batchCancelOrders(ids);
        assertEq(MARGIN.getBalance(bob, address(0)), marginBefore, "cancel refunds the locked MON");
    }

    function test_graduate_reusesAMarketSomeoneDeployedFirst() public {
        address token = launchOnKuru();
        JunoLaunchpad.Pool memory p = launchpad.getPool(token);
        KuruGraduator.MarketParams memory m = kuru.marketParams(p.migrationBase, p.migrationQuoteThreshold);

        // A griefer front-runs graduation with the identical market (same CREATE2 address).
        vm.prank(bob);
        address squatted = ROUTER.deployProxy(
            2,
            token,
            address(0),
            m.sizePrecision,
            m.pricePrecision,
            m.tickSize,
            m.minSize,
            m.maxSize,
            30,
            10,
            100
        );

        (address market,) = fillAndGraduate(token);
        assertEq(market, squatted, "graduation reuses it instead of reverting");
        (uint256 bid, uint256 ask) = IKuruOrderBook(market).bestBidAsk();
        assertGt(ask, 0);
        assertLt(bid, ask);
    }

    function test_launch_refusesWhatKuruCannotList() public {
        // Kuru markets here are priced in MON only.
        JunoLaunchpad.LaunchParams memory lp = params(address(usdc), USDC_START, contentWeights());
        lp.graduator = address(kuru);
        vm.prank(creator);
        vm.expectRevert(KuruGraduator.NativeQuoteOnly.selector);
        launchpad.launch(lp, 0, 0);

        // And only venues the owner offers can be chosen.
        KuruGraduator rogue = new KuruGraduator(address(launchpad), ROUTER, address(MARGIN));
        lp = params(address(0), MON_START, contentWeights());
        lp.graduator = address(rogue);
        vm.prank(creator);
        vm.expectRevert(JunoLaunchpad.GraduatorNotAllowed.selector);
        launchpad.launch(lp, 0, 0);

        vm.prank(owner);
        launchpad.setGraduatorAllowed(kuru, false);
        lp.graduator = address(kuru);
        vm.prank(creator);
        vm.expectRevert(JunoLaunchpad.GraduatorNotAllowed.selector);
        launchpad.launch(lp, 0, 0);
    }
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
}
