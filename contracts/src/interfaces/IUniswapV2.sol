// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev The slice of Uniswap v2 Juno uses. Deliberately not Uniswap's router:
/// the graduator transfers into the pair and calls `mint` itself, which works
/// whatever state someone has left the pair's reserves in, and
/// `JunoSwapRouter` trades a graduated coin the same way — transfer in, then
/// `swap` — so neither depends on a periphery deployment Monad testnet lacks.
interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

interface IUniswapV2Pair {
    function mint(address to) external returns (uint256 liquidity);
    function token0() external view returns (address);
    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    /// @dev Used by `JunoSwapRouter` only, after it has sent the input to the pair.
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function transfer(address to, uint256 value) external returns (bool);
}
