// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

contract Getter {
  function time() external view returns (uint256) {
    return block.timestamp;
  }
}
