// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReceiverTemplate} from "./vendor/ReceiverTemplate.sol";

/// @title JunoNavOracle
/// @notice Where Juno's Chainlink CRE workflow (`cre/juno-nav`) writes what each tracker coin is
///         worth against the thing it tracks.
/// @dev A tracker coin (the `tight-nav` curve preset) stands for `unitsPerToken` of an underlying
///      priced by a Pyth feed: a share of a stock, a pre-IPO valuation. On every run the workflow
///      reads the feeds over HTTP with median consensus across the DON, reads each coin's curve
///      price from `JunoLaunchpad` on chain, restates it in the underlying's units, and reports the
///      premium to NAV. This contract keeps the latest attestation per coin, so anything on Monad
///      (an app, a guard, another contract) can read a NAV that no single server vouched for.
///
///      Reports arrive only through the Chainlink forwarder (`ReceiverTemplate`), optionally pinned
///      to one workflow and owner. Each report carries the time it was observed, and an older or
///      repeated report reverts, so a replayed report cannot roll a NAV back.
contract JunoNavOracle is ReceiverTemplate {
    /// @notice One coin's reading, as the workflow encodes it.
    struct NavPoint {
        address token;
        /// The Pyth feed id of the underlying.
        bytes32 feedId;
        /// The underlying's price, USD, 18 decimals.
        uint256 navUsdE18;
        /// When Pyth published that price (unix seconds).
        uint64 navPublishTime;
        /// The curve's price restated per unit of the underlying, USD, 18 decimals.
        uint256 impliedUsdE18;
        /// (implied - nav) / nav, in basis points.
        int256 premiumBps;
        /// The preset's band: within it, the curve is tracking.
        uint16 bandBps;
    }

    struct Attestation {
        bytes32 feedId;
        uint256 navUsdE18;
        uint256 impliedUsdE18;
        int256 premiumBps;
        uint64 navPublishTime;
        uint64 observedAt;
        uint16 bandBps;
        bool withinBand;
    }

    mapping(address token => Attestation) private s_latest;
    /// @notice The observation time of the last report accepted.
    uint64 public lastObservedAt;
    /// @notice Reports accepted.
    uint256 public reportCount;

    event NavAttested(
        address indexed token,
        bytes32 indexed feedId,
        uint256 navUsdE18,
        uint256 impliedUsdE18,
        int256 premiumBps,
        bool withinBand,
        uint64 observedAt
    );

    error EmptyReport();
    error StaleReport(uint64 observedAt, uint64 lastObservedAt);
    error ZeroNav(address token);

    constructor(address forwarder) ReceiverTemplate(forwarder) {}

    /// @notice The latest attestation for a coin; `observedAt` is zero when there is none.
    function navOf(address token) external view returns (Attestation memory) {
        return s_latest[token];
    }

    function _processReport(bytes calldata report) internal override {
        (uint64 observedAt, NavPoint[] memory points) = abi.decode(report, (uint64, NavPoint[]));
        if (points.length == 0) revert EmptyReport();
        if (observedAt <= lastObservedAt) revert StaleReport(observedAt, lastObservedAt);
        lastObservedAt = observedAt;
        reportCount += 1;

        for (uint256 i = 0; i < points.length; i++) {
            NavPoint memory p = points[i];
            if (p.navUsdE18 == 0) revert ZeroNav(p.token);
            uint256 distance = p.premiumBps < 0 ? uint256(-p.premiumBps) : uint256(p.premiumBps);
            bool within = distance <= p.bandBps;
            s_latest[p.token] = Attestation({
                feedId: p.feedId,
                navUsdE18: p.navUsdE18,
                impliedUsdE18: p.impliedUsdE18,
                premiumBps: p.premiumBps,
                navPublishTime: p.navPublishTime,
                observedAt: observedAt,
                bandBps: p.bandBps,
                withinBand: within
            });
            emit NavAttested(p.token, p.feedId, p.navUsdE18, p.impliedUsdE18, p.premiumBps, within, observedAt);
        }
    }
}
