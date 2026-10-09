// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Testnet only. A 6-decimal test dollar we can mint, because Kuru's testnet USDC and Agora's testnet
/// AUSD have no public faucet. Used as the collateral and quote of the Kuru fallback market until Kuru
/// lists the Spot V2 market against its USDC. Never deployed on mainnet.
contract TestDollar is ERC20 {
    address public immutable minter;

    constructor() ERC20("Floorline Test Dollar (testnet only)", "tUSD") {
        minter = msg.sender;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "minter");
        _mint(to, amount);
    }
}
