// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import {JunoToken} from "./JunoToken.sol";
import {CurveMath} from "./libraries/CurveMath.sol";
import {IJunoGraduator} from "./interfaces/IJunoGraduator.sol";

/// @title JunoLaunchpad
/// @notice Every post is a market. Publishing a post launches a token whose
/// entire supply is sold on a sixteen-segment bonding curve; the creator earns
/// the trading fees; when the curve fills, its reserves graduate into an AMM
/// pair whose liquidity is locked for good.
///
/// ## The curve
///
/// A curve is a start price and sixteen ranges above it, each with its own
/// liquidity. The liquidity in a range sets how much supply that stretch of the
/// curve absorbs per unit of price — so the sixteen weights are the character
/// of a launch. Back-loaded weights make a content coin (cheap to enter, steep
/// late); front-loaded weights make a thin listed name (a deep book at the
/// issue price); a book shape makes an IPO (depth at both ends, discovery in
/// the middle); uniform weights make a tracker that should not drift.
///
/// The curve itself is computed off-chain (`lib/juno/curves.ts`) and validated
/// here: prices strictly increasing, liquidity non-zero, and the supply the
/// curve sells plus the supply reserved for migration must fit inside the
/// fixed one-billion-token supply. The quote the curve raises by its top is
/// the migration threshold, computed here from the ranges rather than trusted
/// from the caller.
///
/// ## Price continuity at graduation
///
/// The base reserved for migration is the threshold priced at the curve's top.
/// The AMM therefore opens at exactly the price the curve finished on: nobody
/// can buy the last token on the curve and sell it into the pair for a
/// guaranteed profit.
///
/// ## Fees
///
/// Charged in the quote token on both sides. They decay exponentially from a
/// launch fee, which blunts snipers in the first minutes, to a resting fee,
/// over sixty periods. The protocol takes a share fixed at launch; the creator
/// takes the rest, claimable at any time.
contract JunoLaunchpad is Ownable2Step, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /* ------------------------------------------------------------------ */
    /* Constants                                                          */
    /* ------------------------------------------------------------------ */

    uint256 public constant SEGMENTS = 16;
    /// @notice Every Juno token has one billion units of 18 decimals.
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint16 public constant MAX_FEE_BPS = 9_900;
    uint16 public constant MIN_FEE_BPS = 25;
    uint16 public constant MAX_PROTOCOL_SHARE_BPS = 5_000;
    uint256 public constant FEE_PERIODS = 60;
    uint256 internal constant FEE_DENOMINATOR = 1_000_000;
    uint256 internal constant WAD = 1e18;
    /// @notice Below this the Q96 square root has too few bits to trade on.
    uint160 public constant MIN_SQRT_PRICE = 1 << 32;
    /// @notice address(0) as a quote token means native MON.
    address public constant NATIVE = address(0);

    /* ------------------------------------------------------------------ */
    /* Types                                                              */
    /* ------------------------------------------------------------------ */

    /// @notice One range of the curve: its upper bound and its liquidity.
    /// The lower bound is the previous range's upper bound, or the start price.
    struct Segment {
        uint160 sqrtPriceX96;
        uint128 liquidity;
    }

    struct LaunchParams {
        string name;
        string symbol;
        /// @dev Pinned metadata, usually `ipfs://…`.
        string uri;
        /// @dev An allowed quote token, or address(0) for native MON.
        address quote;
        /// @dev Which preset shaped this curve. Informational: the curve is the rule.
        uint8 preset;
        uint160 sqrtStartPriceX96;
        Segment[16] curve;
        uint16 startFeeBps;
        uint16 endFeeBps;
        uint32 feeDecaySeconds;
        /// @dev Per-period decay in WAD: fee(n) = start * (1 - decay)^n, floored at end.
        uint64 feeDecayWad;
    }

    struct Pool {
        address creator;
        uint40 launchedAt;
        uint8 preset;
        bool complete;
        bool graduated;
        address quote;
        uint16 startFeeBps;
        uint16 endFeeBps;
        uint32 feeDecaySeconds;
        uint16 protocolShareBps;
        uint64 feeDecayWad;
        uint160 sqrtPriceX96;
        uint160 sqrtStartPriceX96;
        /// @dev The pair this token graduates into, locked at launch.
        address venue;
        address graduator;
        /// @dev Curve supply not yet sold.
        uint256 baseReserve;
        /// @dev Quote the curve holds, fees excluded.
        uint256 quoteReserve;
        /// @dev Base set aside for the AMM at graduation.
        uint256 migrationBase;
        /// @dev Quote the curve holds at its top.
        uint256 migrationQuoteThreshold;
        /// @dev Supply neither sold nor migrated — the rounding buffer, burned at graduation.
        uint256 leftover;
        uint256 creatorFees;
        uint256 creatorFeesClaimed;
    }

    /* ------------------------------------------------------------------ */
    /* State                                                              */
    /* ------------------------------------------------------------------ */

    mapping(address token => Pool) internal _pools;
    mapping(address token => Segment[16]) internal _curves;
    mapping(address quote => bool) public allowedQuote;
    mapping(address quote => uint256) public protocolFees;
    mapping(address creator => uint256) public launchCount;
    address[] public tokens;

    IJunoGraduator public graduator;
    uint16 public protocolShareBps;

    /* ------------------------------------------------------------------ */
    /* Events                                                             */
    /* ------------------------------------------------------------------ */

    event Launched(
        address indexed token,
        address indexed creator,
        address indexed quote,
        uint8 preset,
        string name,
        string symbol,
        string uri,
        uint160 sqrtStartPriceX96,
        uint160 sqrtEndPriceX96,
        uint256 curveBase,
        uint256 migrationBase,
        uint256 migrationQuoteThreshold,
        address venue
    );

    /// @param trader Whose position changed: the recipient of a buy, the seller of a sell.
    /// @param quoteAmount What the trader paid (buy, fee included) or received (sell, fee deducted).
    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 baseAmount,
        uint256 quoteAmount,
        uint256 fee,
        uint160 sqrtPriceX96,
        uint256 quoteReserve
    );

    event CurveCompleted(address indexed token, uint256 quoteReserve);
    event Graduated(
        address indexed token, address indexed venue, uint256 baseAmount, uint256 quoteAmount, uint256 liquidity, uint256 burned
    );
    event CreatorFeesClaimed(address indexed token, address indexed creator, address to, uint256 amount);
    event ProtocolFeesClaimed(address indexed quote, address to, uint256 amount);
    event QuoteAllowed(address indexed quote, bool allowed);
    event GraduatorSet(address indexed graduator);
    event ProtocolShareSet(uint16 bps);

    /* ------------------------------------------------------------------ */
    /* Errors                                                             */
    /* ------------------------------------------------------------------ */

    error UnknownPool();
    error QuoteNotAllowed();
    error BadMetadata();
    error BadFees();
    error BadCurve();
    error SupplyExceeded(uint256 required);
    error CurveComplete();
    error CurveNotComplete();
    error AlreadyGraduated();
    error NoGraduator();
    error Expired();
    error ZeroAmount();
    error BadValue();
    error Slippage(uint256 got, uint256 wanted);
    error InsufficientLiquidity();
    error NotCreator();
    error TransferFailed();

    constructor(address owner_, uint16 protocolShareBps_) Ownable(owner_) {
        _setProtocolShare(protocolShareBps_);
        allowedQuote[NATIVE] = true;
        emit QuoteAllowed(NATIVE, true);
    }

    /* ------------------------------------------------------------------ */
    /* Launch                                                             */
    /* ------------------------------------------------------------------ */

    /// @notice Launch a post as a market, optionally with the creator's own first buy.
    /// @param firstBuy Quote to spend buying from the fresh curve in the same
    /// transaction, so nobody can get in ahead of the creator. Zero for none.
    /// For a native quote it must equal `msg.value`.
    function launch(LaunchParams calldata params, uint256 firstBuy, uint256 minBaseOut)
        external
        payable
        nonReentrant
        returns (address token)
    {
        if (!allowedQuote[params.quote]) revert QuoteNotAllowed();
        _checkMetadata(params);
        _checkFees(params);
        (uint256 curveBase, uint256 threshold) = _checkCurve(params);

        uint160 top = params.curve[SEGMENTS - 1].sqrtPriceX96;
        uint256 migrationBase = CurveMath.baseForQuoteAt(threshold, top);
        uint256 required = curveBase + migrationBase;
        if (required > TOTAL_SUPPLY) revert SupplyExceeded(required);

        token = address(
            new JunoToken{salt: _salt(msg.sender)}(params.name, params.symbol, params.uri, msg.sender, TOTAL_SUPPLY)
        );
        launchCount[msg.sender] += 1;
        tokens.push(token);

        IJunoGraduator g = graduator;
        address venue;
        if (address(g) != address(0)) {
            venue = g.prepare(token, params.quote);
            JunoToken(token).setPair(venue);
        }

        Pool storage p = _pools[token];
        p.creator = msg.sender;
        p.launchedAt = uint40(block.timestamp);
        p.preset = params.preset;
        p.quote = params.quote;
        p.startFeeBps = params.startFeeBps;
        p.endFeeBps = params.endFeeBps;
        p.feeDecaySeconds = params.feeDecaySeconds;
        p.feeDecayWad = params.feeDecayWad;
        p.protocolShareBps = protocolShareBps;
        p.sqrtPriceX96 = params.sqrtStartPriceX96;
        p.sqrtStartPriceX96 = params.sqrtStartPriceX96;
        p.venue = venue;
        p.graduator = address(g);
        p.baseReserve = curveBase;
        p.migrationBase = migrationBase;
        p.migrationQuoteThreshold = threshold;
        p.leftover = TOTAL_SUPPLY - required;

        Segment[16] storage stored = _curves[token];
        for (uint256 i; i < SEGMENTS; ++i) {
            stored[i] = params.curve[i];
        }

        emit Launched(
            token,
            msg.sender,
            params.quote,
            params.preset,
            params.name,
            params.symbol,
            params.uri,
            params.sqrtStartPriceX96,
            top,
            curveBase,
            migrationBase,
            threshold,
            venue
        );

        if (firstBuy > 0) {
            _collect(params.quote, firstBuy);
            _buy(token, p, firstBuy, minBaseOut, msg.sender);
        } else if (msg.value != 0) {
            revert BadValue();
        }
    }

    /// @notice The address `launch` will deploy the caller's next token to.
    function predictToken(address creator, string calldata name, string calldata symbol, string calldata uri)
        external
        view
        returns (address)
    {
        bytes32 codeHash = keccak256(
            abi.encodePacked(type(JunoToken).creationCode, abi.encode(name, symbol, uri, creator, TOTAL_SUPPLY))
        );
        return Create2.computeAddress(_salt(creator), codeHash);
    }

    /* ------------------------------------------------------------------ */
    /* Trade                                                              */
    /* ------------------------------------------------------------------ */

    /// @notice Buy with an exact amount of quote.
    /// @dev If the curve fills part-way through, the buy takes what the curve
    /// can sell and refunds the rest — so "finish this curve" is one call, not
    /// a search for the exact remaining size.
    /// @return baseOut Tokens sent to `recipient`.
    /// @return quotePaid Quote actually spent, fee included.
    function buy(address token, uint256 quoteIn, uint256 minBaseOut, address recipient, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 baseOut, uint256 quotePaid)
    {
        if (block.timestamp > deadline) revert Expired();
        Pool storage p = _live(token);
        _collect(p.quote, quoteIn);
        (baseOut, quotePaid) = _buy(token, p, quoteIn, minBaseOut, recipient);
    }

    /// @notice Sell an exact amount of tokens back to the curve. No approval
    /// needed: Juno tokens let their launchpad pull from the seller directly.
    function sell(address token, uint256 baseIn, uint256 minQuoteOut, address recipient, uint256 deadline)
        external
        nonReentrant
        returns (uint256 quoteOut)
    {
        if (block.timestamp > deadline) revert Expired();
        if (baseIn == 0) revert ZeroAmount();
        Pool storage p = _live(token);

        (uint256 gross, uint160 sqrtAfter) = _walkDown(token, p.sqrtPriceX96, p.sqrtStartPriceX96, baseIn);
        if (gross > p.quoteReserve) gross = p.quoteReserve;
        uint256 fee = Math.mulDiv(gross, _feePpm(p), FEE_DENOMINATOR, Math.Rounding.Ceil);
        quoteOut = gross - fee;
        if (quoteOut == 0) revert ZeroAmount();
        if (quoteOut < minQuoteOut) revert Slippage(quoteOut, minQuoteOut);

        p.sqrtPriceX96 = sqrtAfter;
        p.baseReserve += baseIn;
        p.quoteReserve -= gross;
        _accrue(p, fee);

        IERC20(token).safeTransferFrom(msg.sender, address(this), baseIn);
        _pay(p.quote, recipient, quoteOut);

        emit Trade(token, msg.sender, false, baseIn, quoteOut, fee, sqrtAfter, p.quoteReserve);
    }

    /* ------------------------------------------------------------------ */
    /* Graduation                                                         */
    /* ------------------------------------------------------------------ */

    /// @notice Move a completed curve's reserves into its AMM pair and lock the
    /// liquidity. Anyone may call it; the outcome does not depend on who does.
    function graduate(address token) external nonReentrant returns (address venue, uint256 liquidity) {
        Pool storage p = _pools[token];
        if (p.creator == address(0)) revert UnknownPool();
        if (p.graduated) revert AlreadyGraduated();
        if (!p.complete) revert CurveNotComplete();
        if (p.graduator == address(0)) revert NoGraduator();

        p.graduated = true;
        uint256 quoteAmount = p.quoteReserve;
        uint256 baseAmount = p.migrationBase;
        // Whatever the curve did not sell is rounding dust; add the buffer and burn both.
        uint256 burned = p.baseReserve + p.leftover;
        p.quoteReserve = 0;
        p.baseReserve = 0;
        p.leftover = 0;

        JunoToken(token).markGraduated();
        IERC20(token).safeTransfer(p.graduator, baseAmount);
        if (p.quote == NATIVE) {
            (venue, liquidity) =
                IJunoGraduator(p.graduator).graduate{value: quoteAmount}(token, NATIVE, baseAmount, quoteAmount);
        } else {
            IERC20(p.quote).safeTransfer(p.graduator, quoteAmount);
            (venue, liquidity) = IJunoGraduator(p.graduator).graduate(token, p.quote, baseAmount, quoteAmount);
        }
        if (burned > 0) JunoToken(token).burn(burned);

        emit Graduated(token, venue, baseAmount, quoteAmount, liquidity, burned);
    }

    /* ------------------------------------------------------------------ */
    /* Fees                                                               */
    /* ------------------------------------------------------------------ */

    /// @notice Pay a creator everything their post's market has earned so far.
    function claimCreatorFees(address token, address to) external nonReentrant returns (uint256 amount) {
        Pool storage p = _pools[token];
        if (p.creator == address(0)) revert UnknownPool();
        if (msg.sender != p.creator) revert NotCreator();
        amount = p.creatorFees;
        if (amount == 0) revert ZeroAmount();
        p.creatorFees = 0;
        p.creatorFeesClaimed += amount;
        _pay(p.quote, to, amount);
        emit CreatorFeesClaimed(token, msg.sender, to, amount);
    }

    function claimProtocolFees(address quote, address to) external onlyOwner nonReentrant returns (uint256 amount) {
        amount = protocolFees[quote];
        if (amount == 0) revert ZeroAmount();
        protocolFees[quote] = 0;
        _pay(quote, to, amount);
        emit ProtocolFeesClaimed(quote, to, amount);
    }

    /* ------------------------------------------------------------------ */
    /* Admin                                                              */
    /* ------------------------------------------------------------------ */

    function setQuoteAllowed(address quote, bool allowed) external onlyOwner {
        allowedQuote[quote] = allowed;
        emit QuoteAllowed(quote, allowed);
    }

    /// @notice Applies to launches from now on. Existing pools keep theirs.
    function setGraduator(IJunoGraduator graduator_) external onlyOwner {
        graduator = graduator_;
        emit GraduatorSet(address(graduator_));
    }

    /// @notice Applies to launches from now on. Existing pools keep theirs.
    function setProtocolShare(uint16 bps) external onlyOwner {
        _setProtocolShare(bps);
    }

    /* ------------------------------------------------------------------ */
    /* Views                                                              */
    /* ------------------------------------------------------------------ */

    function getPool(address token) external view returns (Pool memory) {
        return _pools[token];
    }

    function getCurve(address token) external view returns (uint160 sqrtStartPriceX96, Segment[16] memory curve) {
        return (_pools[token].sqrtStartPriceX96, _curves[token]);
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    /// @notice The trading fee right now, in parts per million.
    function currentFeePpm(address token) external view returns (uint256) {
        Pool storage p = _pools[token];
        if (p.creator == address(0)) revert UnknownPool();
        return _feePpm(p);
    }

    /// @notice What `buy` would do right now, without doing it.
    function quoteBuy(address token, uint256 quoteIn)
        external
        view
        returns (uint256 baseOut, uint256 quotePaid, uint256 fee, uint160 sqrtAfter)
    {
        Pool storage p = _live(token);
        return _quoteBuy(token, p, quoteIn);
    }

    /// @notice What `sell` would do right now, without doing it.
    function quoteSell(address token, uint256 baseIn)
        external
        view
        returns (uint256 quoteOut, uint256 fee, uint160 sqrtAfter)
    {
        Pool storage p = _live(token);
        uint256 gross;
        (gross, sqrtAfter) = _walkDown(token, p.sqrtPriceX96, p.sqrtStartPriceX96, baseIn);
        if (gross > p.quoteReserve) gross = p.quoteReserve;
        fee = Math.mulDiv(gross, _feePpm(p), FEE_DENOMINATOR, Math.Rounding.Ceil);
        quoteOut = gross - fee;
    }

    /* ------------------------------------------------------------------ */
    /* Internals                                                          */
    /* ------------------------------------------------------------------ */

    function _buy(address token, Pool storage p, uint256 quoteIn, uint256 minBaseOut, address recipient)
        internal
        returns (uint256 baseOut, uint256 quotePaid)
    {
        uint256 fee;
        uint160 sqrtAfter;
        (baseOut, quotePaid, fee, sqrtAfter) = _quoteBuy(token, p, quoteIn);
        if (baseOut == 0) revert ZeroAmount();
        if (baseOut < minBaseOut) revert Slippage(baseOut, minBaseOut);

        p.sqrtPriceX96 = sqrtAfter;
        p.baseReserve -= baseOut;
        p.quoteReserve += quotePaid - fee;
        _accrue(p, fee);

        uint160 top = _curves[token][SEGMENTS - 1].sqrtPriceX96;
        bool completed = sqrtAfter >= top;
        if (completed) p.complete = true;

        IERC20(token).safeTransfer(recipient, baseOut);
        if (quoteIn > quotePaid) _pay(p.quote, msg.sender, quoteIn - quotePaid);

        emit Trade(token, recipient, true, baseOut, quotePaid, fee, sqrtAfter, p.quoteReserve);
        if (completed) emit CurveCompleted(token, p.quoteReserve);
    }

    function _quoteBuy(address token, Pool storage p, uint256 quoteIn)
        internal
        view
        returns (uint256 baseOut, uint256 quotePaid, uint256 fee, uint160 sqrtAfter)
    {
        if (quoteIn == 0) revert ZeroAmount();
        uint256 feePpm = _feePpm(p);
        fee = Math.mulDiv(quoteIn, feePpm, FEE_DENOMINATOR, Math.Rounding.Ceil);
        uint256 curveIn = quoteIn - fee;

        uint256 used;
        (baseOut, used, sqrtAfter) = _walkUp(token, p.sqrtPriceX96, p.sqrtStartPriceX96, curveIn);
        if (used < curveIn) {
            // Partial fill at the top: charge the fee on what was actually used.
            fee = Math.mulDiv(used, feePpm, FEE_DENOMINATOR - feePpm, Math.Rounding.Ceil);
        }
        if (baseOut > p.baseReserve) baseOut = p.baseReserve;
        quotePaid = used + fee;
    }

    /// @dev Walk the price up through the ranges, spending `amount` of quote.
    function _walkUp(address token, uint160 sqrtP, uint160 sqrtStart, uint256 amount)
        internal
        view
        returns (uint256 baseOut, uint256 used, uint160)
    {
        Segment[16] storage curve = _curves[token];
        uint256 remaining = amount;
        for (uint256 i; i < SEGMENTS && remaining > 0; ++i) {
            Segment memory seg = curve[i];
            uint160 lower = i == 0 ? sqrtStart : curve[i - 1].sqrtPriceX96;
            if (sqrtP >= seg.sqrtPriceX96) continue;
            if (sqrtP < lower) sqrtP = lower;

            uint256 toTop = CurveMath.quoteDelta(sqrtP, seg.sqrtPriceX96, seg.liquidity, true);
            if (remaining >= toTop) {
                baseOut += CurveMath.baseDelta(sqrtP, seg.sqrtPriceX96, seg.liquidity, false);
                remaining -= toTop;
                sqrtP = seg.sqrtPriceX96;
            } else {
                uint160 next = CurveMath.nextSqrtPriceFromQuoteIn(sqrtP, seg.liquidity, remaining);
                if (next > seg.sqrtPriceX96) next = seg.sqrtPriceX96;
                baseOut += CurveMath.baseDelta(sqrtP, next, seg.liquidity, false);
                remaining = 0;
                sqrtP = next;
            }
        }
        used = amount - remaining;
        return (baseOut, used, sqrtP);
    }

    /// @dev Walk the price down through the ranges, absorbing `amount` of base.
    /// Reverts if the curve cannot take it all — selling below the start price
    /// would pay out quote nobody put in.
    function _walkDown(address token, uint160 sqrtP, uint160 sqrtStart, uint256 amount)
        internal
        view
        returns (uint256 quoteOut, uint160)
    {
        if (amount == 0) revert ZeroAmount();
        Segment[16] storage curve = _curves[token];
        uint256 remaining = amount;
        for (uint256 j = SEGMENTS; j > 0 && remaining > 0; --j) {
            uint256 i = j - 1;
            uint160 lower = i == 0 ? sqrtStart : curve[i - 1].sqrtPriceX96;
            if (sqrtP <= lower) continue;
            uint128 liquidity = curve[i].liquidity;

            uint256 toBottom = CurveMath.baseDelta(lower, sqrtP, liquidity, true);
            if (remaining >= toBottom) {
                quoteOut += CurveMath.quoteDelta(lower, sqrtP, liquidity, false);
                remaining -= toBottom;
                sqrtP = lower;
            } else {
                uint160 next = CurveMath.nextSqrtPriceFromBaseIn(sqrtP, liquidity, remaining);
                if (next < lower) next = lower;
                quoteOut += CurveMath.quoteDelta(next, sqrtP, liquidity, false);
                remaining = 0;
                sqrtP = next;
            }
        }
        if (remaining > 0) revert InsufficientLiquidity();
        return (quoteOut, sqrtP);
    }

    /// @dev fee(n) = start * (1 - decay)^n over sixty periods, floored at end.
    function _feePpm(Pool storage p) internal view returns (uint256) {
        uint256 start = uint256(p.startFeeBps) * 100;
        uint256 end = uint256(p.endFeeBps) * 100;
        if (start == end || p.feeDecaySeconds == 0) return end;
        uint256 periodLength = p.feeDecaySeconds / FEE_PERIODS;
        if (periodLength == 0) periodLength = 1;
        uint256 period = (block.timestamp - p.launchedAt) / periodLength;
        if (period >= FEE_PERIODS) return end;
        uint256 fee = Math.mulDiv(start, _rpow(WAD - p.feeDecayWad, period), WAD);
        return fee < end ? end : fee;
    }

    function _rpow(uint256 x, uint256 n) internal pure returns (uint256 z) {
        z = WAD;
        while (n > 0) {
            if (n & 1 == 1) z = Math.mulDiv(z, x, WAD);
            x = Math.mulDiv(x, x, WAD);
            n >>= 1;
        }
    }

    function _accrue(Pool storage p, uint256 fee) internal {
        uint256 protocol = (fee * p.protocolShareBps) / 10_000;
        protocolFees[p.quote] += protocol;
        p.creatorFees += fee - protocol;
    }

    function _collect(address quote, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        if (quote == NATIVE) {
            if (msg.value != amount) revert BadValue();
        } else {
            if (msg.value != 0) revert BadValue();
            IERC20(quote).safeTransferFrom(msg.sender, address(this), amount);
        }
    }

    function _pay(address quote, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (quote == NATIVE) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(quote).safeTransfer(to, amount);
        }
    }

    function _live(address token) internal view returns (Pool storage p) {
        p = _pools[token];
        if (p.creator == address(0)) revert UnknownPool();
        if (p.complete) revert CurveComplete();
    }

    function _salt(address creator) internal view returns (bytes32) {
        return keccak256(abi.encode(creator, launchCount[creator]));
    }

    function _checkMetadata(LaunchParams calldata params) internal pure {
        uint256 nameLength = bytes(params.name).length;
        uint256 symbolLength = bytes(params.symbol).length;
        if (nameLength == 0 || nameLength > 64) revert BadMetadata();
        if (symbolLength == 0 || symbolLength > 16) revert BadMetadata();
        if (bytes(params.uri).length > 256) revert BadMetadata();
    }

    function _checkFees(LaunchParams calldata params) internal pure {
        if (params.startFeeBps > MAX_FEE_BPS) revert BadFees();
        if (params.endFeeBps < MIN_FEE_BPS) revert BadFees();
        if (params.endFeeBps > params.startFeeBps) revert BadFees();
        if (params.feeDecayWad >= WAD) revert BadFees();
    }

    /// @dev Validates the ranges and returns the supply they sell and the quote they raise.
    function _checkCurve(LaunchParams calldata params) internal pure returns (uint256 curveBase, uint256 threshold) {
        uint160 lower = params.sqrtStartPriceX96;
        if (lower < MIN_SQRT_PRICE) revert BadCurve();
        for (uint256 i; i < SEGMENTS; ++i) {
            Segment calldata seg = params.curve[i];
            if (seg.sqrtPriceX96 <= lower || seg.liquidity == 0) revert BadCurve();
            curveBase += CurveMath.baseDelta(lower, seg.sqrtPriceX96, seg.liquidity, true);
            threshold += CurveMath.quoteDelta(lower, seg.sqrtPriceX96, seg.liquidity, true);
            lower = seg.sqrtPriceX96;
        }
        if (threshold == 0 || curveBase == 0) revert BadCurve();
    }

    function _setProtocolShare(uint16 bps) internal {
        if (bps > MAX_PROTOCOL_SHARE_BPS) revert BadFees();
        protocolShareBps = bps;
        emit ProtocolShareSet(bps);
    }

    receive() external payable {
        // Native quote arrives only through `launch`/`buy`; refuse stray sends.
        revert BadValue();
    }
}
