// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev The slice of Kuru v1 (https://docs.kuru.io) the graduator and the app use.
/// Signatures checked against the ABIs in github.com/Kuru-Labs/kuru-sdk and the
/// deployed testnet contracts.
interface IKuruRouter {
    /// @param marketType 0 = both ERC-20, 1 = native base, 2 = native quote.
    function deployProxy(
        uint8 marketType,
        address baseAsset,
        address quoteAsset,
        uint96 sizePrecision,
        uint32 pricePrecision,
        uint32 tickSize,
        uint96 minSize,
        uint96 maxSize,
        uint256 takerFeeBps,
        uint256 makerFeeBps,
        uint96 kuruAmmSpread
    ) external returns (address market);

    function computeAddress(
        address baseAsset,
        address quoteAsset,
        uint96 sizePrecision,
        uint32 pricePrecision,
        uint32 tickSize,
        uint96 minSize,
        uint96 maxSize,
        uint256 takerFeeBps,
        uint256 makerFeeBps,
        uint96 kuruAmmSpread,
        address oldImplementation,
        bool old
    ) external view returns (address market);

    /// @dev All zero for an address the Router did not deploy.
    function verifiedMarket(address market)
        external
        view
        returns (
            uint32 pricePrecision,
            uint96 sizePrecision,
            address baseAsset,
            uint256 baseDecimals,
            address quoteAsset,
            uint256 quoteDecimals,
            uint32 tickSize,
            uint96 minSize,
            uint96 maxSize,
            uint256 takerFeeBps,
            uint256 makerFeeBps
        );
}

interface IKuruOrderBook {
    /// @dev One fill. Nothing is indexed; `isBuy` is the taker's side, `price`
    /// is 1e18-scaled quote per base, and `filledSize` is in sizePrecision units,
    /// gross of the taker fee. `orderId` 0 is the AMM vault.
    event Trade(
        uint40 orderId,
        address makerAddress,
        bool isBuy,
        uint256 price,
        uint96 updatedSize,
        address takerAddress,
        address txOrigin,
        uint96 filledSize
    );

    /// @dev `quoteSize` is in pricePrecision units of quote; for a native quote msg.value is the same amount in wei.
    function placeAndExecuteMarketBuy(
        uint96 quoteSize,
        uint256 minAmountOut,
        bool isMargin,
        bool isFillOrKill
    ) external payable returns (uint256 baseOut);

    function placeAndExecuteMarketSell(uint96 size, uint256 minAmountOut, bool isMargin, bool isFillOrKill)
        external
        payable
        returns (uint256 quoteOut);

    /// @dev Limit orders: `price` in pricePrecision units, `size` in sizePrecision
    /// units, paid from the caller's MarginAccount balance.
    function addBuyOrder(uint32 price, uint96 size, bool postOnly) external;

    function addSellOrder(uint32 price, uint96 size, bool postOnly) external;

    function batchCancelOrders(uint40[] calldata orderIds) external;

    /// @dev The id the most recent order was given.
    function s_orderIdCounter() external view returns (uint40);

    /// @dev A resting order; `size` is what is left of it.
    function s_orders(uint40 orderId)
        external
        view
        returns (
            address owner,
            uint96 size,
            uint40 prev,
            uint40 next,
            uint40 flippedId,
            uint32 price,
            uint32 flippedPrice,
            bool isBuy
        );

    event OrderCreated(uint40 orderId, address owner, uint96 size, uint32 price, bool isBuy);
    event OrdersCanceled(uint40[] orderId, address owner);

    /// @dev Best bid and best ask, 1e18-scaled.
    function bestBidAsk() external view returns (uint256, uint256);

    function getVaultParams()
        external
        view
        returns (address vault, uint256, uint96, uint256, uint96, uint96, uint96, uint96);

    function getMarketParams()
        external
        view
        returns (
            uint32 pricePrecision,
            uint96 sizePrecision,
            address baseAsset,
            uint256 baseDecimals,
            address quoteAsset,
            uint256 quoteDecimals,
            uint32 tickSize,
            uint96 minSize,
            uint96 maxSize,
            uint256 takerFeeBps,
            uint256 makerFeeBps
        );
}

interface IKuruMarginAccount {
    /// @dev `token` = address(0) for native MON, with the amount as msg.value.
    function deposit(address user, address token, uint256 amount) external payable;

    function withdraw(uint256 amount, address token) external;

    function batchWithdrawMaxTokens(address[] calldata tokens) external;

    function getBalance(address user, address token) external view returns (uint256);
}

interface IKuruVault {
    /// @return baseAssets and quoteAssets the vault holds.
    function totalAssets() external view returns (uint256, uint256);

    /// @dev For a native quote, `msg.value` is the quote deposit. Shares go to `receiver`.
    function deposit(uint256 baseDeposit, uint256 quoteDeposit, uint256 minQuoteConsumed, address receiver)
        external
        payable
        returns (uint256 shares);
}
