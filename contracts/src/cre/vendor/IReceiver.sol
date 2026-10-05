// SPDX-License-Identifier: MIT
// Copied unmodified from Chainlink's CRE docs (Building Consumer Contracts), except
// the IERC165 import, which points at OpenZeppelin's identical interface.
// https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts
pragma solidity ^0.8.0;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IReceiver - receives keystone reports
/// @notice Implementations must support the IReceiver interface through ERC165.
interface IReceiver is IERC165 {
  /// @notice Handles incoming keystone reports.
  /// @dev If this function call reverts, it can be retried with a higher gas
  /// limit. The receiver is responsible for discarding stale reports.
  /// @param metadata Report's metadata.
  /// @param report Workflow report.
  function onReport(
    bytes calldata metadata,
    bytes calldata report
  ) external;
}
