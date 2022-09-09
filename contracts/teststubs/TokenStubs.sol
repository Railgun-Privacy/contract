// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
  constructor() ERC20("testERC20", "testERC20") {
    _mint(msg.sender, type(uint256).max);
  }
}
