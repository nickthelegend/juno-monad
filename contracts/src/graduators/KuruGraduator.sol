// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IJunoGraduator} from "../interfaces/IJunoGraduator.sol";
import {IKuruOrderBook, IKuruRouter, IKuruVault} from "../interfaces/IKuru.sol";

/// @title KuruGraduator
/// @notice Graduates a completed Juno curve into a Kuru order-book market: a
/// new spot market for the post's token against MON, its AMM vault seeded with
/// the curve's reserves at exactly the price the curve finished on, and the
/// vault's LP shares sent to the dead address so that depth stays for good.
///
/// Every post that fills becomes a new asset with a real order book — limit
/// orders, market orders, a backstop AMM — rather than one more constant-
/// product pair.
///
/// ## What the pre-graduation lock guards
///
/// The token refuses transfers into the address `prepare` returns until the
/// launchpad marks it graduated. For Kuru that address is the MarginAccount:
/// every way a token enters Kuru — a sell order, a market sell, a vault
/// deposit, a multi-hop swap, a forwarded meta-transaction — moves it into the
/// MarginAccount. So before graduation nobody can post a sell, seed a vault or
/// otherwise price the token on Kuru.
///
/// On testnet anyone may create a market, so someone can deploy the market
/// this graduator would deploy — same parameters, same CREATE2 address — ahead
/// of time. That market cannot hold any of the token (the lock), so its vault
/// is empty; graduation reuses it instead of reverting on the collision, and
/// the first vault deposit, ours, sets its price. Bids someone parked in it
/// cost only them. The one thing the lock cannot stop is quote-side dust
/// donated to the vault, which can only move the opening price in the
/// curve's favour at the donor's expense.
///
/// ## Mainnet
///
/// Kuru's mainnet Router only lets its owner create markets, so this
/// graduator would revert there and leave a filled curve stranded. The deploy
/// script offers it on testnet only.
///
/// Native MON quote only: a Juno token priced in MON is Kuru market type 2.
contract KuruGraduator is IJunoGraduator {
    using SafeERC20 for IERC20;

    /// @notice Vault shares minted here can never be redeemed, so the depth is permanent.
    address public constant LOCK = 0x000000000000000000000000000000000000dEaD;

    /// @notice Kuru market type for a token priced in native MON.
    uint8 public constant NATIVE_IN_QUOTE = 2;
    uint256 public constant TAKER_FEE_BPS = 30;
    uint256 public constant MAKER_FEE_BPS = 10;
    /// @notice The vault's spread, 1% — Kuru's recommendation for a volatile pair.
    uint96 public constant AMM_SPREAD = 100;

    address public immutable launchpad;
    IKuruRouter public immutable router;
    address public immutable marginAccount;

    /// @notice The Kuru market each graduated token trades on.
    mapping(address token => address market) public marketOf;

    error OnlyLaunchpad();
    error NativeQuoteOnly();
    error BadValue();
    error PriceOutOfRange(uint256 priceWad);

    event KuruMarketOpened(
        address indexed token, address indexed market, address vault, uint32 pricePrecision
    );

    constructor(address launchpad_, IKuruRouter router_, address marginAccount_) {
        launchpad = launchpad_;
        router = router_;
        marginAccount = marginAccount_;
    }

    modifier onlyLaunchpad() {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        _;
    }

    /// @dev The venue to lock is Kuru's MarginAccount — see the contract notes.
    /// Refuses a curve whose graduation price a Kuru market could not quote,
    /// at launch rather than when it fills.
    function prepare(address, address quote, uint256 baseAmount, uint256 quoteAmount)
        external
        view
        onlyLaunchpad
        returns (address)
    {
        if (quote != address(0)) revert NativeQuoteOnly();
        marketParams(baseAmount, quoteAmount);
        return marginAccount;
    }

    function graduate(address token, address quote, uint256 baseAmount, uint256 quoteAmount)
        external
        payable
        onlyLaunchpad
        returns (address market, uint256 liquidity)
    {
        if (quote != address(0)) revert NativeQuoteOnly();
        if (msg.value != quoteAmount) revert BadValue();

        MarketParams memory m = marketParams(baseAmount, quoteAmount);
        market = router.computeAddress(
            token,
            address(0),
            m.sizePrecision,
            m.pricePrecision,
            m.tickSize,
            m.minSize,
            m.maxSize,
            TAKER_FEE_BPS,
            MAKER_FEE_BPS,
            AMM_SPREAD,
            address(0),
            false
        );
        // Reuse a market someone created ahead of us rather than revert on the
        // CREATE2 collision — its vault cannot hold any of the token yet.
        if (market.code.length == 0) {
            market = router.deployProxy(
                NATIVE_IN_QUOTE,
                token,
                address(0),
                m.sizePrecision,
                m.pricePrecision,
                m.tickSize,
                m.minSize,
                m.maxSize,
                TAKER_FEE_BPS,
                MAKER_FEE_BPS,
                AMM_SPREAD
            );
        }

        marketOf[token] = market;

        // Only the vault's address is needed; the rest describes its state.
        // slither-disable-next-line unused-return
        (address vault,,,,,,,) = IKuruOrderBook(market).getVaultParams();
        IERC20(token).forceApprove(vault, baseAmount);
        liquidity = IKuruVault(vault).deposit{value: quoteAmount}(baseAmount, quoteAmount, quoteAmount, LOCK);

        emit KuruMarketOpened(token, market, vault, m.pricePrecision);
    }

    struct MarketParams {
        uint32 pricePrecision;
        uint32 tickSize;
        uint96 sizePrecision;
        uint96 minSize;
        uint96 maxSize;
    }

    /// @notice The market parameters for a graduation at `quoteAmount / baseAmount`.
    /// @dev Kuru prices are uint32 in `pricePrecision` units, and precisions must
    /// be powers of ten. The precision follows Kuru's own SDK
    /// (`calculatePrecisions`): the smallest that puts three significant digits
    /// on the graduation price (at most 1e9), and sizes use the same precision.
    /// The minimum order is the round number of tokens worth about 0.001 MON;
    /// the maximum is the SDK's uint32 bound.
    ///
    /// The tick is one unit of price — 0.1% to 1% of the graduation price —
    /// rather than the SDK example's 1%. The vault quotes a 1% spread, so with
    /// a 1% tick its bid and ask sit one tick apart and a resting order can
    /// only queue behind one of them; a finer tick lets people bid and offer
    /// inside the vault's spread, which is what makes the book a book.
    ///
    /// Prices are capped at (2^32 - 1) / pricePrecision, so three digits leave
    /// ~4,000,000x of headroom above the graduation price. `maxSize` bounds a
    /// single limit order (1-10 million tokens here); market orders filled by
    /// the vault are not held to it — the fork tests fill five times over it.
    function marketParams(uint256 baseAmount, uint256 quoteAmount)
        public
        pure
        returns (MarketParams memory m)
    {
        if (baseAmount == 0) revert PriceOutOfRange(0);
        // Quote per base, 1e18-scaled. Both are 18-decimal tokens. Every use
        // below scales it by at most 1e9 before dividing by 1e18, so its
        // truncation moves a result by under one part in a billion.
        // slither-disable-next-line divide-before-multiply
        uint256 priceWad = (quoteAmount * 1e18) / baseAmount;

        uint256 precision = 1;
        while (precision < 1e9 && (priceWad * precision) / 1e18 < 100) precision *= 10;
        uint256 priceInt = (priceWad * precision) / 1e18;
        // Under 1e-8 MON a tick would be more than 10% of the price, and above
        // uint32 / 1000 there is no room left to trade upwards.
        if (priceInt < 10 || priceInt > type(uint32).max / 1_000) revert PriceOutOfRange(priceWad);

        m.pricePrecision = uint32(precision);
        m.tickSize = 1;
        m.sizePrecision = uint96(precision);

        // Tokens worth ~0.001 MON, rounded down to a power of ten, at least one.
        uint256 minTokens = 1;
        while (minTokens * 10 * priceWad <= 1e15) minTokens *= 10;
        m.minSize = uint96(minTokens * precision);

        // Kuru's bound: the largest power of ten below (2^32 - 1) * sizePrecision / priceInt.
        uint256 ceiling = (uint256(type(uint32).max) * precision) / priceInt;
        uint256 maxSize = 1;
        while (maxSize * 10 <= ceiling) maxSize *= 10;
        m.maxSize = uint96(maxSize);
    }
}
