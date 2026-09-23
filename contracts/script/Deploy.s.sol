// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {JunoLaunchpad} from "../src/JunoLaunchpad.sol";
import {UniswapV2Graduator} from "../src/graduators/UniswapV2Graduator.sol";
import {IUniswapV2Factory} from "../src/interfaces/IUniswapV2.sol";

/// @title Deploy
/// @notice Deploys Juno to Monad: the launchpad, a Uniswap v2 graduator, and —
/// on a network without an official Uniswap v2 (Monad testnet) — the canonical
/// v2-core factory for it to graduate into.
///
/// Usually run through `contracts/deploy.sh testnet|mainnet`. Directly:
///
///     # simulate only (writes deployments/<chainid>.dry-run.json)
///     forge script script/Deploy.s.sol --rpc-url monad_testnet --sender 0xYou
///
///     # for real
///     forge script script/Deploy.s.sol --rpc-url monad_testnet \
///         --account monad-deployer --sender 0xYou --broadcast \
///         --gas-estimate-multiplier 110
///
/// Signer — either works:
///   - an encrypted keystore: `--account <name>` (created with
///     `cast wallet import <name> --interactive`) plus `--sender <its address>`;
///   - `DEPLOYER_PRIVATE_KEY` in the environment (hex, with or without 0x).
///     Takes precedence over `--account` when both are present.
///
/// Environment (all optional):
///   JUNO_OWNER               final owner of the launchpad. Default: the deployer.
///                            Handed over with Ownable2Step, so the new owner
///                            must call `acceptOwnership()` once.
///   JUNO_PROTOCOL_SHARE_BPS  protocol's cut of trading fees. Default 2000 (20%).
///   WMON                     wrapped MON. Default: the chain's canonical WMON.
///   JUNO_USDC                the stable to allow as a quote. Default: Circle USDC.
///   UNISWAP_V2_FACTORY       v2 factory to graduate into. Default: the official
///                            one on mainnet; on any other chain, a fresh
///                            deployment of the canonical v2-core factory.
contract Deploy is Script {
    uint256 internal constant MONAD_MAINNET = 143;
    uint256 internal constant MONAD_TESTNET = 10143;

    // Monad mainnet.
    address internal constant MAINNET_WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address internal constant MAINNET_USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address internal constant MAINNET_UNISWAP_V2_FACTORY = 0x182a927119D56008d921126764bF884221b10f59;

    // Monad testnet. No official Uniswap v2 here: the script deploys one.
    address internal constant TESTNET_WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;
    address internal constant TESTNET_USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;

    /// @dev Compiled from lib/v2-core @ v1.0.1 by src/vendor/UniswapV2Core.sol.
    string internal constant V2_FACTORY_ARTIFACT = "UniswapV2Factory.sol:UniswapV2Factory";
    string internal constant V2_PAIR_ARTIFACT = "UniswapV2Pair.sol:UniswapV2Pair";

    uint256 internal constant DEFAULT_PROTOCOL_SHARE_BPS = 2_000;

    struct Deployment {
        uint256 chainId;
        address deployer;
        address owner;
        uint16 protocolShareBps;
        address launchpad;
        address graduator;
        address uniswapV2Factory;
        bool uniswapV2FactoryDeployed;
        address wmon;
        address usdc;
        uint256 deployBlock;
    }

    error NoSigner();
    error NoCode(string what, address at);
    error Unconfigured(string envVar);
    error BadUsdcDecimals(uint8 decimals);
    error BadProtocolShare(uint256 bps);

    function run() external returns (Deployment memory d) {
        d.chainId = block.chainid;

        // ---- Configuration, all checked before anything is sent ----------

        (address wmonDefault, address usdcDefault, address factoryDefault) = _networkDefaults(d.chainId);
        d.wmon = _envAddress("WMON", wmonDefault);
        d.usdc = _envAddress("JUNO_USDC", usdcDefault);
        d.uniswapV2Factory = _envAddress("UNISWAP_V2_FACTORY", factoryDefault);

        if (d.wmon == address(0)) revert Unconfigured("WMON");
        if (d.usdc == address(0)) revert Unconfigured("JUNO_USDC");
        _requireCode("WMON", d.wmon);
        _requireCode("USDC", d.usdc);
        // The app prices USDC with 6 decimals; a different stable would misprice every curve.
        uint8 usdcDecimals = IERC20Metadata(d.usdc).decimals();
        if (usdcDecimals != 6) revert BadUsdcDecimals(usdcDecimals);

        if (d.uniswapV2Factory != address(0)) {
            _requireCode("UNISWAP_V2_FACTORY", d.uniswapV2Factory);
            // Cheap interface check: a v2 factory answers getPair for any two addresses.
            IUniswapV2Factory(d.uniswapV2Factory).getPair(d.wmon, d.usdc);
        } else if (d.chainId == MONAD_MAINNET) {
            // Never stand up a private v2 on mainnet by accident.
            revert Unconfigured("UNISWAP_V2_FACTORY");
        }

        uint256 share = _envUint("JUNO_PROTOCOL_SHARE_BPS", DEFAULT_PROTOCOL_SHARE_BPS);
        if (share > 5_000) revert BadProtocolShare(share); // the launchpad's own cap
        // casting to 'uint16' is safe because `share` was just checked to be <= 5_000
        // forge-lint: disable-next-line(unsafe-typecast)
        d.protocolShareBps = uint16(share);

        // ---- Signer --------------------------------------------------------

        uint256 key = _privateKey();
        if (key != 0) {
            vm.startBroadcast(key);
        } else {
            // `--account`/`--ledger`/… with `--sender`. Without either, forge
            // would sign as its well-known default sender, which is never meant.
            if (msg.sender == DEFAULT_SENDER) revert NoSigner();
            vm.startBroadcast();
        }
        (, d.deployer,) = vm.readCallers();
        d.owner = _envAddress("JUNO_OWNER", d.deployer);
        // A lower bound on the block the launchpad lands in: where the app's log scan starts.
        d.deployBlock = block.number;

        // ---- Deploy ------------------------------------------------------

        if (d.uniswapV2Factory == address(0)) {
            // feeToSetter: whoever owns Juno. The v2 protocol fee stays off unless they turn it on.
            d.uniswapV2Factory = vm.deployCode(V2_FACTORY_ARTIFACT, abi.encode(d.owner));
            d.uniswapV2FactoryDeployed = true;
        }

        // Owned by the deployer until it is wired, then handed over.
        JunoLaunchpad launchpad = new JunoLaunchpad(d.deployer, d.protocolShareBps);
        UniswapV2Graduator graduator =
            new UniswapV2Graduator(address(launchpad), IUniswapV2Factory(d.uniswapV2Factory), d.wmon);
        launchpad.setGraduator(graduator);
        launchpad.setQuoteAllowed(d.usdc, true);
        if (d.owner != d.deployer) launchpad.transferOwnership(d.owner);

        vm.stopBroadcast();

        d.launchpad = address(launchpad);
        d.graduator = address(graduator);

        _write(d);
        _log(d);
    }

    /* ------------------------------------------------------------------ */
    /* Network defaults                                                    */
    /* ------------------------------------------------------------------ */

    function _networkDefaults(uint256 chainId)
        internal
        pure
        returns (address wmon, address usdc, address factory)
    {
        if (chainId == MONAD_MAINNET) return (MAINNET_WMON, MAINNET_USDC, MAINNET_UNISWAP_V2_FACTORY);
        if (chainId == MONAD_TESTNET) return (TESTNET_WMON, TESTNET_USDC, address(0));
        // Anything else (a local anvil, a fork under another id): everything from the environment.
        return (address(0), address(0), address(0));
    }

    function _networkName(uint256 chainId) internal pure returns (string memory) {
        if (chainId == MONAD_MAINNET) return "mainnet";
        if (chainId == MONAD_TESTNET) return "testnet";
        return "custom";
    }

    /* ------------------------------------------------------------------ */
    /* Output                                                              */
    /* ------------------------------------------------------------------ */

    /// @dev A broadcast writes `deployments/<chainid>.json`; a simulation writes
    /// `<chainid>.dry-run.json`, so rehearsing against a live network never
    /// overwrites the record of what is actually deployed there. The file is
    /// written after simulation, before forge sends anything: the addresses are
    /// nonce-derived and final, but if the broadcast fails part-way, trust
    /// `broadcast/Deploy.s.sol/<chainid>/run-latest.json` for what landed.
    function _write(Deployment memory d) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", d.chainId);
        vm.serializeString(k, "network", _networkName(d.chainId));
        vm.serializeAddress(k, "deployer", d.deployer);
        vm.serializeAddress(k, "owner", d.owner);
        vm.serializeBool(k, "ownershipPending", d.owner != d.deployer);
        vm.serializeUint(k, "protocolShareBps", d.protocolShareBps);
        vm.serializeAddress(k, "launchpad", d.launchpad);
        vm.serializeAddress(k, "graduator", d.graduator);
        vm.serializeAddress(k, "uniswapV2Factory", d.uniswapV2Factory);
        vm.serializeBool(k, "uniswapV2FactoryDeployed", d.uniswapV2FactoryDeployed);
        if (d.uniswapV2FactoryDeployed) {
            // A router for this factory needs this in its `pairFor`; it differs
            // from Uniswap's mainnet constant because the metadata differs.
            vm.serializeBytes32(k, "uniswapV2PairInitCodeHash", keccak256(vm.getCode(V2_PAIR_ARTIFACT)));
        }
        vm.serializeAddress(k, "wmon", d.wmon);
        vm.serializeAddress(k, "usdc", d.usdc);
        string memory json = vm.serializeUint(k, "deployBlock", d.deployBlock);

        bool dryRun = vm.isContext(VmSafe.ForgeContext.ScriptDryRun);
        // A rehearsal against a local fork shares the real network's chain id,
        // so it names its own record (`JUNO_DEPLOYMENT_TAG=10143-fork`) rather
        // than posing as the record of a real deployment.
        string memory tag = vm.envOr("JUNO_DEPLOYMENT_TAG", vm.toString(d.chainId));
        string memory path =
            string.concat(vm.projectRoot(), "/deployments/", tag, dryRun ? ".dry-run.json" : ".json");
        vm.writeJson(json, path);
        console.log("Wrote", path);
    }

    function _log(Deployment memory d) internal pure {
        console.log("");
        console.log("JunoLaunchpad        ", d.launchpad);
        console.log("UniswapV2Graduator   ", d.graduator);
        console.log(
            d.uniswapV2FactoryDeployed ? "UniswapV2Factory (new)" : "UniswapV2Factory     ",
            d.uniswapV2Factory
        );
        console.log("WMON                 ", d.wmon);
        console.log("USDC (allowed quote) ", d.usdc);
        console.log("Owner                ", d.owner);
        if (d.owner != d.deployer) {
            console.log("  pending: the owner must call acceptOwnership() on the launchpad");
        }
        console.log("");
        console.log("# App environment (.env.local / the host's env):");
        console.log(
            string.concat("NEXT_PUBLIC_MONAD_NETWORK=", d.chainId == MONAD_MAINNET ? "mainnet" : "testnet")
        );
        console.log(string.concat("NEXT_PUBLIC_JUNO_LAUNCHPAD=", vm.toString(d.launchpad)));
        console.log(string.concat("JUNO_LAUNCHPAD_DEPLOY_BLOCK=", vm.toString(d.deployBlock)));
        console.log(string.concat("NEXT_PUBLIC_JUNO_USDC=", vm.toString(d.usdc)));
    }

    /* ------------------------------------------------------------------ */
    /* Environment helpers                                                 */
    /* ------------------------------------------------------------------ */

    /// @dev Unset and empty both mean "use the default" — `KEY=` in a .env file is common.
    function _envAddress(string memory name, address fallback_) internal view returns (address) {
        string memory raw = vm.envOr(name, string(""));
        return bytes(raw).length == 0 ? fallback_ : vm.parseAddress(raw);
    }

    function _envUint(string memory name, uint256 fallback_) internal view returns (uint256) {
        string memory raw = vm.envOr(name, string(""));
        return bytes(raw).length == 0 ? fallback_ : vm.parseUint(raw);
    }

    /// @dev Zero when unset. Accepts the key with or without its 0x prefix.
    function _privateKey() internal view returns (uint256) {
        string memory raw = vm.envOr("DEPLOYER_PRIVATE_KEY", string(""));
        if (bytes(raw).length == 0) return 0;
        if (bytes(raw).length == 64) raw = string.concat("0x", raw);
        return vm.parseUint(raw);
    }

    function _requireCode(string memory what, address at) internal view {
        if (at.code.length == 0) revert NoCode(what, at);
    }
}
