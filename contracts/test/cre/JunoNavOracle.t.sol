// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {JunoNavOracle} from "../../src/cre/JunoNavOracle.sol";
import {IReceiver} from "../../src/cre/vendor/IReceiver.sol";
import {ReceiverTemplate} from "../../src/cre/vendor/ReceiverTemplate.sol";

contract JunoNavOracleTest is Test {
    // Monad testnet's MockKeystoneForwarder (what `cre workflow simulate --broadcast` calls through).
    address constant FORWARDER = 0xB9F79d863261869B234c481D1f9A7af84AeAd192;
    address constant COIN = address(0xC01);
    address constant OTHER = address(0xC02);
    bytes32 constant AAPL = 0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688;

    JunoNavOracle oracle;

    event NavAttested(
        address indexed token,
        bytes32 indexed feedId,
        uint256 navUsdE18,
        uint256 impliedUsdE18,
        int256 premiumBps,
        bool withinBand,
        uint64 observedAt
    );

    function setUp() public {
        oracle = new JunoNavOracle(FORWARDER);
    }

    function point(address token, int256 premiumBps) internal pure returns (JunoNavOracle.NavPoint memory) {
        return JunoNavOracle.NavPoint({
            token: token,
            feedId: AAPL,
            navUsdE18: 250e18,
            navPublishTime: 1_790_000_000,
            impliedUsdE18: uint256(int256(250e18) + int256(250e18) * premiumBps / 10_000),
            premiumBps: premiumBps,
            bandBps: 200
        });
    }

    function report(uint64 observedAt, JunoNavOracle.NavPoint[] memory points) internal pure returns (bytes memory) {
        return abi.encode(observedAt, points);
    }

    function one(JunoNavOracle.NavPoint memory p) internal pure returns (JunoNavOracle.NavPoint[] memory points) {
        points = new JunoNavOracle.NavPoint[](1);
        points[0] = p;
    }

    /// The 64 bytes the production forwarder passes: workflow id, name, owner, report id.
    function metadata(bytes32 workflowId, bytes10 name, address owner) internal pure returns (bytes memory) {
        return abi.encodePacked(workflowId, name, owner, bytes2(0));
    }

    function test_storesEachCoinAndEmits() public {
        JunoNavOracle.NavPoint[] memory points = new JunoNavOracle.NavPoint[](2);
        points[0] = point(COIN, 150);
        points[1] = point(OTHER, -350);

        vm.expectEmit(true, true, false, true, address(oracle));
        emit NavAttested(COIN, AAPL, 250e18, points[0].impliedUsdE18, 150, true, 1_790_000_060);
        vm.prank(FORWARDER);
        oracle.onReport("", report(1_790_000_060, points));

        JunoNavOracle.Attestation memory a = oracle.navOf(COIN);
        assertEq(a.navUsdE18, 250e18);
        assertEq(a.premiumBps, 150);
        assertTrue(a.withinBand);
        assertEq(a.observedAt, 1_790_000_060);
        assertEq(a.navPublishTime, 1_790_000_000);

        JunoNavOracle.Attestation memory b = oracle.navOf(OTHER);
        assertEq(b.premiumBps, -350);
        assertFalse(b.withinBand, "a 3.5% discount is outside a 2% band");
        assertEq(oracle.reportCount(), 1);
        assertEq(oracle.lastObservedAt(), 1_790_000_060);
    }

    function test_bandEdgeIsInside() public {
        vm.prank(FORWARDER);
        oracle.onReport("", report(1, one(point(COIN, -200))));
        assertTrue(oracle.navOf(COIN).withinBand);
    }

    function test_onlyTheForwarder() public {
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, address(this), FORWARDER));
        oracle.onReport("", report(1, one(point(COIN, 0))));
    }

    function test_replayAndOlderReportsRevert() public {
        bytes memory first = report(100, one(point(COIN, 10)));
        vm.startPrank(FORWARDER);
        oracle.onReport("", first);
        vm.expectRevert(abi.encodeWithSelector(JunoNavOracle.StaleReport.selector, uint64(100), uint64(100)));
        oracle.onReport("", first);
        vm.expectRevert(abi.encodeWithSelector(JunoNavOracle.StaleReport.selector, uint64(99), uint64(100)));
        oracle.onReport("", report(99, one(point(COIN, 999))));
        vm.stopPrank();
        assertEq(oracle.navOf(COIN).premiumBps, 10, "the replay changed nothing");
    }

    function test_emptyAndZeroNavRevert() public {
        vm.startPrank(FORWARDER);
        vm.expectRevert(JunoNavOracle.EmptyReport.selector);
        oracle.onReport("", report(1, new JunoNavOracle.NavPoint[](0)));
        JunoNavOracle.NavPoint memory zero = point(COIN, 0);
        zero.navUsdE18 = 0;
        vm.expectRevert(abi.encodeWithSelector(JunoNavOracle.ZeroNav.selector, COIN));
        oracle.onReport("", report(1, one(zero)));
        vm.stopPrank();
    }

    function test_pinnedToOneWorkflow() public {
        bytes32 workflowId = keccak256("juno-nav");
        oracle.setExpectedWorkflowId(workflowId);

        vm.startPrank(FORWARDER);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidWorkflowId.selector, keccak256("other"), workflowId));
        oracle.onReport(metadata(keccak256("other"), bytes10(0), address(0xA11CE)), report(1, one(point(COIN, 0))));

        oracle.onReport(metadata(workflowId, bytes10(0), address(0xA11CE)), report(1, one(point(COIN, 0))));
        vm.stopPrank();
        assertEq(oracle.navOf(COIN).observedAt, 1);
    }

    function test_onlyOwnerConfigures() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        oracle.setForwarderAddress(address(0xBAD));
    }

    function test_supportsReceiverInterface() public view {
        assertTrue(oracle.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(oracle.supportsInterface(type(IERC165).interfaceId));
        assertFalse(oracle.supportsInterface(0xdeadbeef));
    }

    function testFuzz_withinBandMatchesDistance(int16 premium) public {
        vm.prank(FORWARDER);
        oracle.onReport("", report(1, one(point(COIN, premium))));
        int256 p = premium;
        assertEq(oracle.navOf(COIN).withinBand, (p < 0 ? -p : p) <= 200);
    }
}
