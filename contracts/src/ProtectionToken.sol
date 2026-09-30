// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice One series of protection. 1 token (1e18) protects 1 whole unit of the underlying.
/// Only the vault that created it can mint or burn.
contract ProtectionToken is ERC20 {
    address public immutable vault;
    uint256 public immutable seriesId;

    error OnlyVault();

    constructor(string memory name_, string memory symbol_, uint256 seriesId_) ERC20(name_, symbol_) {
        vault = msg.sender;
        seriesId = seriesId_;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != vault) revert OnlyVault();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != vault) revert OnlyVault();
        _burn(from, amount);
    }
}
