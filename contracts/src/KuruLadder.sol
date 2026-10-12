// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title KuruLadder
/// @notice The list of Kuru order books for a vault's floor series, so an app can find every floor that
///         trades without scanning logs. The keeper adds a book when it opens a series and its market.
///         Holds no funds and moves nothing; it is a directory.
contract KuruLadder {
    address public immutable vault;
    address public owner;
    uint256[] private _series;
    address[] private _books;
    mapping(uint256 => address) public bookOf;

    event BookAdded(uint256 indexed seriesId, address book);
    event OwnerChanged(address owner);

    error NotOwner();
    error AlreadyListed(uint256 seriesId);
    error ZeroBook();

    constructor(address vault_, address owner_) {
        vault = vault_;
        owner = owner_;
    }

    function add(uint256 seriesId, address book) external {
        if (msg.sender != owner) revert NotOwner();
        if (book == address(0)) revert ZeroBook();
        if (bookOf[seriesId] != address(0)) revert AlreadyListed(seriesId);
        bookOf[seriesId] = book;
        _series.push(seriesId);
        _books.push(book);
        emit BookAdded(seriesId, book);
    }

    function setOwner(address owner_) external {
        if (msg.sender != owner) revert NotOwner();
        owner = owner_;
        emit OwnerChanged(owner_);
    }

    function count() external view returns (uint256) {
        return _books.length;
    }

    /// @notice The last `n` listings, newest last (all of them if fewer).
    function latest(uint256 n) external view returns (uint256[] memory seriesIds, address[] memory books) {
        uint256 len = _books.length;
        uint256 k = n < len ? n : len;
        seriesIds = new uint256[](k);
        books = new address[](k);
        for (uint256 i; i < k; ++i) {
            seriesIds[i] = _series[len - k + i];
            books[i] = _books[len - k + i];
        }
    }
}
