// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Uniswap v2's pair semantics for `mint`, `sync` and `swap`, in 0.8, so
/// the graduation path can be tested without the 0.5.16 originals.
contract MockPair is ERC20 {
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public token0;
    address public token1;
    uint112 private reserve0;
    uint112 private reserve1;

    /// @dev No constructor arguments, like Uniswap's pair, so every pair shares
    /// one init code hash and its address is predictable from the tokens.
    constructor() ERC20("Mock LP", "MLP") {}

    function initialize(address a, address b) external {
        (token0, token1) = (a, b);
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, 0);
    }

    function mint(address to) external returns (uint256 liquidity) {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - reserve0;
        uint256 amount1 = balance1 - reserve1;
        uint256 supply = totalSupply();
        if (supply == 0) {
            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(address(0xdead0000), MINIMUM_LIQUIDITY);
        } else {
            liquidity = Math.min((amount0 * supply) / reserve0, (amount1 * supply) / reserve1);
        }
        require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_MINTED");
        _mint(to, liquidity);
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
    }

    function sync() external {
        reserve0 = uint112(IERC20(token0).balanceOf(address(this)));
        reserve1 = uint112(IERC20(token1).balanceOf(address(this)));
    }
}

contract MockFactory {
    mapping(address => mapping(address => address)) public getPair;

    /// @dev The same CREATE2 scheme as Uniswap v2: salt = keccak(token0, token1).
    function createPair(address a, address b) external returns (address pair) {
        require(getPair[a][b] == address(0), "PAIR_EXISTS");
        (address token0, address token1) = a < b ? (a, b) : (b, a);
        pair = address(new MockPair{salt: keccak256(abi.encodePacked(token0, token1))}());
        MockPair(pair).initialize(token0, token1);
        getPair[a][b] = pair;
        getPair[b][a] = pair;
    }

    function pairCodeHash() external pure returns (bytes32) {
        return keccak256(type(MockPair).creationCode);
    }
}

contract MockWMON is ERC20 {
    constructor() ERC20("Wrapped MON", "WMON") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        payable(msg.sender).transfer(amount);
    }
}

contract MockStable is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
