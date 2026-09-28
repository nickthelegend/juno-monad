// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {JunoBase} from "./JunoBase.t.sol";
import {JunoLaunchpad} from "../src/JunoLaunchpad.sol";
import {JunoSwapRouter} from "../src/JunoSwapRouter.sol";
import {JunoToken} from "../src/JunoToken.sol";
import {UniswapV2Graduator} from "../src/graduators/UniswapV2Graduator.sol";
import {IUniswapV2Factory, IUniswapV2Pair} from "../src/interfaces/IUniswapV2.sol";
import {MockWMON, MockStable} from "./mocks/MockUniswapV2.sol";

/// Trading a coin after it graduates: the real v2-core factory (the one
/// Deploy.s.sol puts on Monad testnet), a real pair made by graduation, and
/// the router in between.
contract JunoSwapRouterTest is JunoBase {
    IUniswapV2Factory internal v2;
    JunoSwapRouter internal router;

    function setUp() public override {
        wmon = new MockWMON();
        usdc = new MockStable();
        v2 = IUniswapV2Factory(deployCode("UniswapV2Factory.sol:UniswapV2Factory", abi.encode(owner)));

        vm.startPrank(owner);
        launchpad = new JunoLaunchpad(owner, PROTOCOL_SHARE_BPS);
        graduator = new UniswapV2Graduator(
            address(launchpad), v2, address(wmon), keccak256(vm.getCode("UniswapV2Pair.sol:UniswapV2Pair"))
        );
        launchpad.setGraduator(graduator);
        launchpad.setQuoteAllowed(address(usdc), true);
        vm.stopPrank();
        router = new JunoSwapRouter(v2, address(wmon));

        vm.deal(alice, 10_000_000 ether);
        vm.deal(bob, 10_000_000 ether);
        usdc.mint(alice, 10_000_000e6);
        usdc.mint(bob, 10_000_000e6);
        vm.prank(alice);
        usdc.approve(address(launchpad), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(launchpad), type(uint256).max);
    }

    function _graduated() internal returns (address token, address pair) {
        token = launchNative();
        buyNative(bob, token, launchpad.getPool(token).migrationQuoteThreshold * 2);
        (pair,) = launchpad.graduate(token);
    }

    function test_buyWithNative_paysWhatItQuoted() public {
        (address token, address pair) = _graduated();
        (uint256 quoted,,) = router.quote(address(0), token, 10 ether);
        uint256 before = JunoToken(token).balanceOf(alice);

        vm.prank(alice);
        uint256 out = router.buyWithNative{value: 10 ether}(token, quoted, alice, block.timestamp);

        assertEq(out, quoted);
        assertEq(JunoToken(token).balanceOf(alice) - before, quoted);
        assertEq(pair, v2.getPair(token, address(wmon)));
        _assertRouterHoldsNothing(token);
    }

    function test_sellForNative_paysMonAndNeedsAnAllowance() public {
        (address token,) = _graduated();
        uint256 held = JunoToken(token).balanceOf(bob) / 10;

        vm.prank(bob);
        vm.expectRevert();
        router.sellForNative(token, held, 0, bob, block.timestamp);

        (uint256 quoted,,) = router.quote(token, address(0), held);
        vm.startPrank(bob);
        JunoToken(token).approve(address(router), held);
        uint256 before = bob.balance;
        uint256 out = router.sellForNative(token, held, quoted, bob, block.timestamp);
        vm.stopPrank();

        assertEq(out, quoted);
        assertEq(bob.balance - before, quoted);
        _assertRouterHoldsNothing(token);
    }

    function test_roundTripLosesOnlyFees(uint256 amount) public {
        (address token,) = _graduated();
        amount = bound(amount, 0.01 ether, 5_000 ether);
        vm.startPrank(alice);
        uint256 bought = router.buyWithNative{value: amount}(token, 0, alice, block.timestamp);
        JunoToken(token).approve(address(router), bought);
        uint256 back = router.sellForNative(token, bought, 0, alice, block.timestamp);
        vm.stopPrank();
        assertLt(back, amount, "never profits");
        // Two 0.3% fees, plus rounding.
        assertApproxEqRel(back, (amount * 997 * 997) / 1_000_000, 1e15);
    }

    function test_slippageAndDeadline() public {
        (address token,) = _graduated();
        (uint256 quoted,,) = router.quote(address(0), token, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(JunoSwapRouter.Slippage.selector, quoted, quoted + 1));
        router.buyWithNative{value: 1 ether}(token, quoted + 1, alice, block.timestamp);

        vm.prank(alice);
        vm.expectRevert(JunoSwapRouter.Expired.selector);
        router.buyWithNative{value: 1 ether}(token, 0, alice, block.timestamp - 1);

        vm.prank(alice);
        vm.expectRevert(JunoSwapRouter.ZeroAmount.selector);
        router.buyWithNative{value: 0}(token, 0, alice, block.timestamp);
    }

    function test_noPairBeforeGraduation() public {
        address token = launchNative();
        vm.prank(alice);
        vm.expectRevert(JunoSwapRouter.NoPair.selector);
        router.buyWithNative{value: 1 ether}(token, 0, alice, block.timestamp);
    }

    function test_refusesStrayMon() public {
        vm.prank(alice);
        (bool ok,) = address(router).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_usdcCoin_bothDirections() public {
        address token = launchUsdc();
        uint256 fill = launchpad.getPool(token).migrationQuoteThreshold * 2;
        vm.prank(bob);
        launchpad.buy(token, fill, 0, bob, block.timestamp);
        launchpad.graduate(token);

        vm.startPrank(alice);
        usdc.approve(address(router), 100e6);
        (uint256 quotedIn,,) = router.quote(address(usdc), token, 100e6);
        uint256 bought = router.swapExactTokens(address(usdc), token, 100e6, quotedIn, alice, block.timestamp);
        assertEq(bought, quotedIn);

        JunoToken(token).approve(address(router), bought);
        uint256 before = usdc.balanceOf(alice);
        uint256 back = router.swapExactTokens(token, address(usdc), bought, 0, alice, block.timestamp);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice) - before, back);
        assertLt(back, 100e6);
        _assertRouterHoldsNothing(token);
    }

    function _assertRouterHoldsNothing(address token) internal view {
        assertEq(address(router).balance, 0, "no MON left in the router");
        assertEq(wmon.balanceOf(address(router)), 0, "no WMON left");
        assertEq(JunoToken(token).balanceOf(address(router)), 0, "no coin left");
        assertEq(usdc.balanceOf(address(router)), 0, "no USDC left");
    }
}
