# How Juno uses Kuru: a post that fills opens its own order book

*Juno · Monad Metropolis, Track 01 · live at https://juno-monad-app.vercel.app (Monad testnet)*

Juno is a social feed where every post is a market. A photo or a reel launches its own coin on a bonding curve on
Monad in one transaction. Fans buy it straight from the feed, and the creator earns the trading fees. When a curve
fills, the coin graduates into its own Kuru order book, seeded from the curve. The creator picks the venue at
launch: Kuru, or a Uniswap v2 pair.

## The problem Kuru solves: where does a creator coin go when it succeeds?

Most creator-coin launchpads end with the curve as the whole market, or with one more constant-product pool.
Neither has limit orders or price discovery beyond a formula. A post that fills its curve has shown real demand,
and it deserves a real market: bids and offers, limit orders, a visible spread. Kuru is a fully on-chain central limit order book on Monad, with an AMM vault behind the book
as a backstop. On testnet its v1 Router lets anyone create a market. That means Juno can open **a new Kuru
market for every coin that graduates**, with no listing process, at the moment the curve completes.

## How it works

### 1. The token cannot be priced on Kuru before graduation

At launch, the graduator tells the launchpad which address to lock. For Kuru that address is the MarginAccount.
Every way a token enters Kuru (a sell order, a vault deposit, a router swap) moves it into the MarginAccount, and
`JunoToken` refuses that transfer until the launchpad marks the coin graduated
([`contracts/src/JunoToken.sol`](../contracts/src/JunoToken.sol)):

```solidity
function _update(address from, address to, uint256 value) internal override {
    if (!graduated && to != address(0) && to == pair) revert PairLocked();
    super._update(from, to, value);
}
```

So nobody can price the token on Kuru ahead of the curve.

### 2. Graduation opens the market and seeds it at the curve's final price

[`KuruGraduator.sol`](../contracts/src/graduators/KuruGraduator.sol) derives the market's parameters from the
curve's final price. It computes the CREATE2 address, deploys through `Router.deployProxy` if nothing is there,
and deposits the curve's raise and reserved supply into the market's vault. The vault shares go to the dead address:

```solidity
(address vault,,,,,,,) = IKuruOrderBook(market).getVaultParams();
IERC20(token).forceApprove(vault, baseAmount);
liquidity = IKuruVault(vault).deposit{value: quoteAmount}(baseAmount, quoteAmount, quoteAmount, LOCK);

emit KuruMarketOpened(token, market, vault, m.pricePrecision);
```

### 3. The app trades the book

[`lib/juno/kuru.ts`](../lib/juno/kuru.ts) is how the app trades a graduated coin. Quotes are free: Kuru's own
simulation path matches an order from the zero address against the book and vault without moving anything.

```ts
const { result } = await publicClient().simulateContract({
  // Kuru's quoting path: from the zero address the book matches the order
  // and returns what it would fill, without taking or paying anything.
  account: zeroAddress,
  address: market,
  abi: kuruOrderBookAbi,
  functionName: side === "buy" ? "placeAndExecuteMarketBuy" : "placeAndExecuteMarketSell",
  args: [sizeArg, 0n, false, false],
});
```

Market buys and sells from the feed, Reels and the coin page become `placeAndExecuteMarketBuy` /
`placeAndExecuteMarketSell` calls, immediate-or-cancel with a slippage floor. Limit orders (`addBuyOrder` /
`addSellOrder`) are paid from the MarginAccount. The server deposits only the shortfall, cancels go through
`batchCancelOrders`, and fills come home with `batchWithdrawMaxTokens`.
[`KuruOrders.tsx`](../juno-expo/components/KuruOrders.tsx) shows a holder their resting orders and what Kuru is
holding for them, so a filled limit order never looks like it vanished. Trade → **Kuru** lists every market Juno has
opened.

### 4. Fills are recorded from receipts

When Juno submits a transaction, `recordReceiptKuruFills` in [`lib/juno/swaps.ts`](../lib/juno/swaps.ts) reads
Kuru's `Trade` events from the receipt and stores them under the ids the indexer would use, so the coin's
activity shows them at once, tagged KURU, without double counting. The Envio indexer registers each new market
from `KuruMarketOpened`.

## Engineering notes

- **Precision follows Kuru's SDK.** Kuru prices are `uint32` in `pricePrecision` units. `marketParams` picks the
  smallest power of ten that gives the graduation price three significant digits, as the SDK's
  `calculatePrecisions` does, and refuses at launch any curve whose final price a Kuru market could not quote.
  That way a filled curve is never stranded.
- **A finer tick than the SDK example.** The vault quotes a 1% spread. With a 1% tick, its bid and ask would sit
  one tick apart and nobody could quote inside them. Juno uses one price unit (0.1–1% of the price), so people
  can bid and offer inside the vault's spread.
- **Squatting is harmless.** Anyone can deploy the same market first on testnet. The graduator reuses whatever
  sits at the CREATE2 address instead of reverting. The lock keeps the token out of it, so its vault is empty
  and Juno's deposit sets the price.
- **Exact MON on buys.** The MON sent must equal the order size in `pricePrecision` units, so the quote rounds
  down and reports `amountUsed`.
- **Testnet only.** Kuru's mainnet Router only lets its owner create markets, so the deploy script offers the
  Kuru graduator on testnet only.
- **Tested against Kuru's real contracts.** `contracts/test/KuruGraduator.t.sol` has 3 unit tests and 7 fork
  tests against Kuru's live Router and MarginAccount (`KURU_FORK_TEST=1`): the lock, graduation at the curve
  price, market and large orders, limit orders (rest, fill, cancel, withdraw) and the squatted market.

## The value it brought

- **A real end state for a post.** "Every post is a market" goes further with Kuru: a post that succeeds ends on
  an order book with locked two-sided depth, instead of on a formula.
- **Issuance to settlement.** Juno handles issuance (the curve) and onboarding (the feed); Kuru handles the book
  and settlement. The graduator, permissionless, is the bridge.
- **One trading path.** After graduation the same buy button routes through Kuru's book.

## Live proof (Monad testnet)

This activity is **team-seeded**: $GRADKURU is a demo coin the team launched and filled to show graduation, and
its market is small.

- $GRADKURU graduated into its new Kuru market `0xD2175fd455bb91d631c9ca95E69902fED171a144`, seeded from the
  curve:
  [0x04de4115…5bda](https://testnet.monadvision.com/tx/0x04de4115b0a993676289c9c94b98f9d96f5927c5ea56d1262312dce5ef715bda)
- A buy on its Kuru book:
  [0xe68f8fff…65d6](https://testnet.monadvision.com/tx/0xe68f8fff7035bd65adf7699621e7b88be3e015731e0082034c66e08355f665d6)
- A sell on its Kuru book:
  [0x2c58097c…7058](https://testnet.monadvision.com/tx/0x2c58097c9843ae74dda6cb2da3e97d95ade00c6ffe7ca27d553c02eb127b7058)

Both trades were recorded from their receipts and show as KURU in the coin's activity. `KuruGraduator`
(`0xBeFD5740896D157A3E9821939e5ba213BEf50F99`) returns that market from `marketOf($GRADKURU)`.

## Honest limits

- The Kuru market shown here is a team-seeded demo, with no organic volume and little depth.
- Limit orders, cancel and withdraw are built and covered by the fork tests and the app's E2E on a fork. The
  testnet evidence above is one market buy and one market sell.
- Mainnet needs Kuru to create markets for Juno, or to open its Router. Until then the Kuru venue is testnet only,
  and mainnet coins would graduate into Uniswap v2.
