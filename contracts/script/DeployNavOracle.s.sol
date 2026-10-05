// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";

import {JunoNavOracle} from "../src/cre/JunoNavOracle.sol";

/// Deploys `JunoNavOracle`, the receiver `cre/juno-nav` writes to.
///
///   FORWARDER=<address> forge script script/DeployNavOracle.s.sol \
///     --rpc-url <rpc> --private-key <key> --broadcast
///
/// FORWARDER defaults to Monad testnet's production KeystoneForwarder. For
/// `cre workflow simulate --broadcast` use the MockKeystoneForwarder,
/// 0xB9F79d863261869B234c481D1f9A7af84AeAd192 (both from Chainlink's forwarder
/// directory). After deploying a workflow, pin the receiver to it with
/// `setExpectedWorkflowId` (and `setExpectedAuthor`).
contract DeployNavOracle is Script {
    address constant TESTNET_FORWARDER = 0xF8344CFd5c43616a4366C34E3EEE75af79a74482;

    function run() external returns (JunoNavOracle oracle) {
        address forwarder = vm.envOr("FORWARDER", TESTNET_FORWARDER);
        vm.startBroadcast();
        oracle = new JunoNavOracle(forwarder);
        vm.stopBroadcast();
        console.log("JunoNavOracle", address(oracle), "forwarder", forwarder);
    }
}
