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
    mapping(uint256 => uint256) public marks;

    /// @dev Sets the oracle price and the mark to the same value, as when the oracle is in sync.
    function set(uint256 marketId, uint256 price6) external {
        prices[marketId] = price6;
        times[marketId] = block.timestamp;
        marks[marketId] = price6;
    }

    function setAt(uint256 marketId, uint256 price6, uint256 time) external {
        prices[marketId] = price6;
        times[marketId] = time;
        marks[marketId] = price6;
    }

    /// @dev Moves only the mark, as when the market moves before the oracle catches up.
    function setMark(uint256 marketId, uint256 mark6) external {
        marks[marketId] = mark6;
    }

    function price(uint256 marketId) external view returns (uint256, uint256) {
        return (prices[marketId], times[marketId]);
    }

    function mark(uint256 marketId) external view returns (uint256, uint256) {
        return (marks[marketId], block.timestamp);
    }
}
