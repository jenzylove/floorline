// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {VolFeed} from "./VolFeed.sol";
import {FloorVault} from "./FloorVault.sol";

/// @notice Chainlink CRE consumer for Floorline. Only the configured forwarder can call `onReport`.
/// A report is `abi.encode(uint8 action, uint256 a, uint256 b)`:
///   1 = write volatility: a = Perpl market id, b = annualised vol (1e18 = 100%)
///   2 = settle an expired series: a = series id
/// This contract is an authorised VolFeed updater. VolFeed enforces the vol bounds, and
/// `settle` is permissionless and checks the price itself, so a bad report cannot move funds.
contract CreReceiver is Ownable, IERC165 {
    uint8 public constant ACTION_SET_VOL = 1;
    uint8 public constant ACTION_SETTLE = 2;

    VolFeed public immutable volFeed;
    FloorVault public immutable vault;
    address public forwarder;

    event ForwarderSet(address forwarder);
    event Reported(uint8 action, uint256 a, uint256 b);

    error NotForwarder(address sender);
    error UnknownAction(uint8 action);

    constructor(VolFeed volFeed_, FloorVault vault_, address forwarder_, address owner_) Ownable(owner_) {
        volFeed = volFeed_;
        vault = vault_;
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    function setForwarder(address forwarder_) external onlyOwner {
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    /// @dev IReceiver.onReport(bytes,bytes). `metadata` carries the workflow id, name and owner;
    /// it is ignored here because the forwarder check is the access control.
    function onReport(bytes calldata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder(msg.sender);
        (uint8 action, uint256 a, uint256 b) = abi.decode(report, (uint8, uint256, uint256));
        if (action == ACTION_SET_VOL) {
            volFeed.update(a, b, "chainlink-cre");
        } else if (action == ACTION_SETTLE) {
            vault.settle(a);
        } else {
            revert UnknownAction(action);
        }
        emit Reported(action, a, b);
    }

    /// @dev 0x805f2132 is the IReceiver interface id (the selector of onReport(bytes,bytes)).
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x805f2132 || interfaceId == type(IERC165).interfaceId;
    }
}
