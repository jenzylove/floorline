// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {KuruLadder} from "../src/KuruLadder.sol";

contract KuruLadderTest is Test {
    KuruLadder ladder;
    address keeper = address(0xBEEF);

    function setUp() public {
        ladder = new KuruLadder(address(0xA11), keeper);
    }

    function test_addAndRead() public {
        vm.startPrank(keeper);
        ladder.add(1, address(0x101));
        ladder.add(2, address(0x102));
        ladder.add(5, address(0x105));
        vm.stopPrank();
        assertEq(ladder.count(), 3);
        assertEq(ladder.bookOf(2), address(0x102));
        (uint256[] memory ids, address[] memory books) = ladder.latest(2);
        assertEq(ids.length, 2);
        assertEq(ids[0], 2);
        assertEq(books[1], address(0x105));
        (ids,) = ladder.latest(10);
        assertEq(ids.length, 3);
    }

    function test_onlyOwner() public {
        vm.expectRevert(KuruLadder.NotOwner.selector);
        ladder.add(1, address(0x101));
    }

    function test_noDoubleListing() public {
        vm.startPrank(keeper);
        ladder.add(1, address(0x101));
        vm.expectRevert(abi.encodeWithSelector(KuruLadder.AlreadyListed.selector, 1));
        ladder.add(1, address(0x102));
        vm.expectRevert(KuruLadder.ZeroBook.selector);
        ladder.add(3, address(0));
    }
}
