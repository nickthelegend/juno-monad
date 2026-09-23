// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Where a completed curve's reserves go.
/// @dev Kept behind an interface so the venue can change without touching the
/// curve. The launchpad calls `prepare` once at launch, so the token can lock
/// the venue's address, and `graduate` once when the curve fills.
interface IJunoGraduator {
    /// @notice Create (or find) the venue for `token`/`quote` and return the
    /// address the token must refuse transfers to until graduation.
    /// @param quote The quote token, or address(0) for native MON.
    function prepare(address token, address quote) external returns (address venue);

    /// @notice Seed the venue with the curve's reserves and lock the position.
    /// @dev The launchpad has already transferred `baseAmount` of `token` and,
    /// for an ERC-20 quote, `quoteAmount` of `quote` to this contract. A native
    /// quote arrives as `msg.value`.
    /// @return venue The pool the reserves now live in.
    /// @return liquidity The LP units minted and permanently locked.
    function graduate(address token, address quote, uint256 baseAmount, uint256 quoteAmount)
        external
        payable
        returns (address venue, uint256 liquidity);
}
