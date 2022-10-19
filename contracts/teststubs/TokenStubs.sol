// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract TestERC20 is ERC20 {
  constructor() ERC20("testERC20", "testERC20") {}

  function mint(address _account, uint256 _amount) external {
    _mint(_account, _amount);
  }
}

contract TestERC721 is ERC721 {
  constructor() ERC721("testERC721", "testERC721") {}

  function mint(address _account, uint256 tokenId) external {
    _mint(_account, tokenId);
  }
}
