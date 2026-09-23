// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity =0.5.16;

// Not Juno code. This file exists only so Foundry compiles the canonical,
// unmodified Uniswap v2-core factory (lib/v2-core @ v1.0.1) with the compiler
// and settings Uniswap shipped it with: solc 0.5.16, 999999 optimizer runs,
// istanbul. The artifact is `UniswapV2Factory.sol:UniswapV2Factory`.
//
// Monad mainnet has an official v2 deployment and the deploy script uses it.
// Monad testnet does not, so `script/Deploy.s.sol` deploys this one there,
// and the preset parity tests graduate into real v2 pairs built from it.
import {UniswapV2Factory} from "@uniswap/v2-core/contracts/UniswapV2Factory.sol";
