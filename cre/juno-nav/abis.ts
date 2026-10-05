import { parseAbi } from "viem";

/** The contracts the workflow reads: Juno's launchpad, Pyth on Monad, a Chainlink data feed. */
export const launchpadAbi = parseAbi([
  "struct Pool { address creator; uint40 launchedAt; uint8 preset; bool complete; bool graduated; address quote; uint16 startFeeBps; uint16 endFeeBps; uint32 feeDecaySeconds; uint16 protocolShareBps; uint64 feeDecayWad; uint160 sqrtPriceX96; uint160 sqrtStartPriceX96; address venue; address graduator; uint256 baseReserve; uint256 quoteReserve; uint256 migrationBase; uint256 migrationQuoteThreshold; uint256 leftover; uint256 creatorFees; uint256 creatorFeesClaimed; }",
  "function getPool(address token) view returns (Pool)",
]);

export const pythAbi = parseAbi([
  "struct Price { int64 price; uint64 conf; int32 expo; uint256 publishTime; }",
  "function getPriceUnsafe(bytes32 id) view returns (Price)",
]);

export const aggregatorAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
