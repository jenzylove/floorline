// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {FloorVault} from "../src/FloorVault.sol";
import {VolFeed} from "../src/VolFeed.sol";
import {CreReceiver} from "../src/CreReceiver.sol";
import {MockAUSD, MockPriceSource} from "./mocks/Mocks.sol";

contract CreReceiverTest is Test {
    uint256 constant MON = 10;
    MockAUSD ausd;
    MockPriceSource px;
    VolFeed vol;
    FloorVault vault;
    CreReceiver rx;
    address owner = makeAddr("owner");
    address fwd = makeAddr("forwarder");

    function setUp() public {
        vm.warp(1_790_000_000);
        ausd = new MockAUSD();
        px = new MockPriceSource();
        vol = new VolFeed(owner);
        vault = new FloorVault(ausd, px, vol, owner);
        rx = new CreReceiver(vol, vault, fwd, owner);
        vm.prank(owner);
        vol.setObserver(address(rx), true);
    }

    function test_forwarderRecordsObservedVolOnly() public {
        vm.prank(fwd);
        rx.onReport("", abi.encode(uint8(1), MON, 2.5e18));
        (uint256 v, uint256 at) = vol.getObserved(MON);
        assertEq(v, 2.5e18);
        assertEq(at, block.timestamp);
        // the pricing input is untouched: a report through the (unsigned) simulation forwarder cannot move it
        (uint256 priced,) = vol.get(MON);
        assertEq(priced, 0);
    }

    function test_receiverCannotWritePricingVol() public {
        vm.prank(address(rx));
        vm.expectRevert(VolFeed.NotUpdater.selector);
        vol.update(MON, 0.1e18, "spoof");
    }

    function test_expectedWorkflowIsChecked() public {
        address wfOwner = makeAddr("wfOwner");
        bytes10 name = bytes10("floorline1");
        vm.prank(owner);
        rx.setExpectedWorkflow(wfOwner, name);

        bytes memory good = abi.encodePacked(bytes32(uint256(1)), name, wfOwner);
        vm.prank(fwd);
        rx.onReport(good, abi.encode(uint8(1), MON, 2e18));

        bytes memory bad = abi.encodePacked(bytes32(uint256(1)), name, makeAddr("stranger"));
        vm.prank(fwd);
        vm.expectRevert();
        rx.onReport(bad, abi.encode(uint8(1), MON, 2e18));
    }

    function test_nonForwarderReverts() public {
        vm.expectRevert(abi.encodeWithSelector(CreReceiver.NotForwarder.selector, address(this)));
        rx.onReport("", abi.encode(uint8(1), MON, 1e18));
    }

    function test_volBoundsStillApply() public {
        vm.prank(fwd);
        vm.expectRevert(abi.encodeWithSelector(VolFeed.VolOutOfBounds.selector, 9e18));
        rx.onReport("", abi.encode(uint8(1), MON, 9e18));
    }

    function test_unknownActionReverts() public {
        vm.prank(fwd);
        vm.expectRevert(abi.encodeWithSelector(CreReceiver.UnknownAction.selector, uint8(9)));
        rx.onReport("", abi.encode(uint8(9), 0, 0));
    }

    function test_interfaceIds() public view {
        assertTrue(rx.supportsInterface(0x805f2132));
        assertTrue(rx.supportsInterface(0x01ffc9a7));
        assertFalse(rx.supportsInterface(0xdeadbeef));
        assertEq(bytes4(keccak256("onReport(bytes,bytes)")), bytes4(0x805f2132));
    }
}
