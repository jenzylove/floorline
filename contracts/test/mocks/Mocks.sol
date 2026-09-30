// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IPriceSource} from "../../src/interfaces/IPriceSource.sol";

contract MockAUSD is ERC20 {
    constructor() ERC20("Mock AUSD", "AUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockPriceSource is IPriceSource {
    mapping(uint256 => uint256) public prices;
    mapping(uint256 => uint256) public times;

    function set(uint256 marketId, uint256 price6) external {
        prices[marketId] = price6;
        times[marketId] = block.timestamp;
    }

    function setAt(uint256 marketId, uint256 price6, uint256 time) external {
        prices[marketId] = price6;
        times[marketId] = time;
    }

    function price(uint256 marketId) external view returns (uint256, uint256) {
        return (prices[marketId], times[marketId]);
    }
}
