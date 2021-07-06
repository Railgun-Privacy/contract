// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
  constructor() ERC20("testERC20", "testERC20") {
    _mint(msg.sender, 100000000 * 10**18); // 100 million tokens, 18 decimal places
  }
}
