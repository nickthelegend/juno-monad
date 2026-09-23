// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title JunoToken
/// @notice One post, one token. Minted in full to the launchpad that sells it
/// on a bonding curve, then graduated into an AMM pair that outlives the app.
///
/// Two departures from a plain ERC-20, both in service of that one market:
///
/// 1. **The pair is locked until graduation.** The AMM pair is created at
///    launch and its address fixed here. Until the curve completes, nobody can
///    send tokens to it. Otherwise anyone could seed the pair at a price of
///    their choosing before the curve's reserves arrive, and the migration's
///    liquidity would be minted against that ratio — donating the difference
///    to whoever got there first.
///
/// 2. **The launchpad needs no allowance.** It is this token's own market and
///    only ever moves tokens out of `msg.sender`, so selling is one signature
///    instead of an `approve` followed by a `sell`. Every other spender goes
///    through the normal allowance path.
contract JunoToken is ERC20, ERC20Permit {
    /// @notice The launchpad that minted and sells this token.
    address public immutable launchpad;
    /// @notice The wallet that published the post.
    address public immutable creator;
    /// @notice Pinned metadata: name, description, media. Usually `ipfs://…`.
    string public tokenURI;
    /// @notice The AMM pair this token graduates into. Zero before launch completes.
    address public pair;
    /// @notice Set once the curve's reserves have moved into `pair`.
    bool public graduated;

    error OnlyLaunchpad();
    error PairLocked();
    error PairAlreadySet();

    event PairSet(address indexed pair);
    event Graduated(address indexed pair);

    modifier onlyLaunchpad() {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        _;
    }

    constructor(string memory name_, string memory symbol_, string memory uri_, address creator_, uint256 supply)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        launchpad = msg.sender;
        creator = creator_;
        tokenURI = uri_;
        _mint(msg.sender, supply);
    }

    function setPair(address pair_) external onlyLaunchpad {
        if (pair != address(0)) revert PairAlreadySet();
        pair = pair_;
        emit PairSet(pair_);
    }

    function markGraduated() external onlyLaunchpad {
        graduated = true;
        emit Graduated(pair);
    }

    /// @notice Burn your own tokens. The launchpad burns the curve's rounding
    /// buffer this way at graduation.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (!graduated && to != address(0) && to == pair) revert PairLocked();
        super._update(from, to, value);
    }

    function _spendAllowance(address owner, address spender, uint256 value) internal override {
        if (spender == launchpad) return;
        super._spendAllowance(owner, spender, value);
    }
}
