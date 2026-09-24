// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev The slice of Uniswap v2 the graduator uses. Deliberately not the router:
/// the graduator transfers into the pair and calls `mint` itself, which works
/// whatever state someone has left the pair's reserves in.
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
}

interface IWrappedNative {
    function deposit() external payable;
    function transfer(address to, uint256 value) external returns (bool);
}
