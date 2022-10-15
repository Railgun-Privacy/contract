// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract TestERC20 is ERC20 {
  constructor() ERC20("testERC20", "testERC20") {
    _mint(msg.sender, type(uint256).max);
  }
}

contract TestERC721 is ERC721 {
  constructor() ERC721("testERC721", "testERC721") {}

  function mint(uint256 tokenId) internal virtual {
    _mint(msg.sender, tokenId);
  }
}
