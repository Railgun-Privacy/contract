// SPDX-License-Identifier: UNLICENSED
pragma abicoder v2;
pragma solidity ^0.8.0;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
  constructor() ERC20("testERC20", "testERC20") {
    _mint(msg.sender, 21000000 * 10**18); // 21 million tokens, 18 decimal places
  }
}
