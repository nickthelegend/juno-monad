// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title CurveMath
/// @notice Concentrated-liquidity arithmetic for a piecewise bonding curve.
/// @dev A Juno curve is up to sixteen price ranges, each holding a constant
/// liquidity `L`. Inside one range the pool behaves exactly like a Uniswap v3
/// position with base as token0 and quote as token1:
///
///     quote between sqrtA and sqrtB = L * (sqrtB - sqrtA)
///     base  between sqrtA and sqrtB = L * (sqrtB - sqrtA) / (sqrtA * sqrtB)
///
/// Prices are square roots in Q64.96, in raw units (quote wei per base wei).
/// More liquidity in a range means more supply absorbed per unit of price, so
/// the weights a launch assigns to its ranges are the shape of its curve.
///
/// Every rounding choice below favours the pool: amounts a trader pays round
/// up, amounts a trader receives round down.
library CurveMath {
    uint256 internal constant Q96 = 1 << 96;

    error ZeroLiquidity();

    /// @notice Base tokens held between two prices.
    function baseDelta(uint160 sqrtA, uint160 sqrtB, uint128 liquidity, bool roundUp)
        internal
        pure
        returns (uint256)
    {
        if (sqrtA > sqrtB) (sqrtA, sqrtB) = (sqrtB, sqrtA);
        if (sqrtA == sqrtB) return 0;
        uint256 numerator1 = uint256(liquidity) << 96;
        uint256 numerator2 = sqrtB - sqrtA;
        if (roundUp) {
            return Math.ceilDiv(Math.mulDiv(numerator1, numerator2, sqrtB, Math.Rounding.Ceil), sqrtA);
        }
        return Math.mulDiv(numerator1, numerator2, sqrtB) / sqrtA;
    }

    /// @notice Quote tokens held between two prices.
    function quoteDelta(uint160 sqrtA, uint160 sqrtB, uint128 liquidity, bool roundUp)
        internal
        pure
        returns (uint256)
    {
        if (sqrtA > sqrtB) (sqrtA, sqrtB) = (sqrtB, sqrtA);
        return Math.mulDiv(liquidity, sqrtB - sqrtA, Q96, roundUp ? Math.Rounding.Ceil : Math.Rounding.Floor);
    }

    /// @notice Where the price lands after `quoteIn` enters a range. Price rises.
    /// @dev Rounds down, so the trader is credited with slightly less movement
    /// than they paid for.
    function nextSqrtPriceFromQuoteIn(uint160 sqrtP, uint128 liquidity, uint256 quoteIn)
        internal
        pure
        returns (uint160)
    {
        if (liquidity == 0) revert ZeroLiquidity();
        return SafeCast.toUint160(uint256(sqrtP) + Math.mulDiv(quoteIn, Q96, liquidity));
    }

    /// @notice Where the price lands after `baseIn` enters a range. Price falls.
    /// @dev `L * sqrtP / (L + baseIn * sqrtP)`, rounded up so the price falls
    /// slightly less than it would exactly — again in the pool's favour.
    function nextSqrtPriceFromBaseIn(uint160 sqrtP, uint128 liquidity, uint256 baseIn)
        internal
        pure
        returns (uint160)
    {
        if (liquidity == 0) revert ZeroLiquidity();
        if (baseIn == 0) return sqrtP;
        uint256 numerator1 = uint256(liquidity) << 96;
        uint256 denominator = numerator1 + baseIn * sqrtP;
        return SafeCast.toUint160(Math.mulDiv(numerator1, sqrtP, denominator, Math.Rounding.Ceil));
    }

    /// @notice Raw price (quote wei per base wei) as a Q96 fraction, floored.
    /// @dev Used for the base side of migration: the reserve leaves the curve
    /// at the curve's final price so the AMM opens exactly where the curve ended.
    function baseForQuoteAt(uint256 quoteAmount, uint160 sqrtP) internal pure returns (uint256) {
        return Math.mulDiv(Math.mulDiv(quoteAmount, Q96, sqrtP), Q96, sqrtP);
    }
}
