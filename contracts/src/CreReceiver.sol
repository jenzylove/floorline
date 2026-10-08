// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {VolFeed} from "./VolFeed.sol";
import {FloorVault} from "./FloorVault.sol";

/// @notice Chainlink CRE consumer for Floorline. Only the configured forwarder can call `onReport`.
/// A report is `abi.encode(uint8 action, uint256 a, uint256 b)`:
///   1 = record observed volatility: a = Perpl market id, b = annualised vol (1e18 = 100%)
///   2 = settle an expired series: a = series id
/// This contract is a VolFeed *observer*, not an updater: what it writes is shown as a cross-check
/// and never used for pricing. `settle` is permissionless and checks price and window itself.
/// While the workflow runs in simulation, the forwarder is Chainlink's simulation forwarder, which
/// does not verify DON signatures. That is why nothing this contract writes can move funds.
/// Once deployed to a DON, set the production forwarder and the expected workflow owner and name.
contract CreReceiver is Ownable, IERC165 {
    uint8 public constant ACTION_SET_VOL = 1;
    uint8 public constant ACTION_SETTLE = 2;

    VolFeed public immutable volFeed;
    FloorVault public immutable vault;
    address public forwarder;
    address public expectedWorkflowOwner; // zero = not checked
    bytes10 public expectedWorkflowName; // zero = not checked

    event ForwarderSet(address forwarder);
    event ExpectedWorkflowSet(address owner, bytes10 name);
    event Reported(uint8 action, uint256 a, uint256 b);

    error NotForwarder(address sender);
    error UnknownAction(uint8 action);
    error WrongWorkflow(address owner, bytes10 name);

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

    function setExpectedWorkflow(address owner_, bytes10 name_) external onlyOwner {
        expectedWorkflowOwner = owner_;
        expectedWorkflowName = name_;
        emit ExpectedWorkflowSet(owner_, name_);
    }

    /// @dev IReceiver.onReport(bytes,bytes). `metadata` is packed: workflow id (32 bytes),
    /// workflow name (10 bytes), workflow owner (20 bytes).
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder(msg.sender);
        if (expectedWorkflowOwner != address(0) || expectedWorkflowName != bytes10(0)) {
            if (metadata.length < 62) revert WrongWorkflow(address(0), bytes10(0));
            bytes10 name = bytes10(metadata[32:42]);
            address wfOwner = address(bytes20(metadata[42:62]));
            if (
                (expectedWorkflowOwner != address(0) && wfOwner != expectedWorkflowOwner)
                    || (expectedWorkflowName != bytes10(0) && name != expectedWorkflowName)
            ) revert WrongWorkflow(wfOwner, name);
        }
        (uint8 action, uint256 a, uint256 b) = abi.decode(report, (uint8, uint256, uint256));
        if (action == ACTION_SET_VOL) {
            volFeed.observe(a, b, "chainlink-cre");
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
