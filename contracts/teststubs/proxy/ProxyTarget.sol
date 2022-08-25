// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

contract ProxyTargetStubA {
  function testFunction() external pure returns (string memory) {
    return "A";
  }
}

contract ProxyTargetStubB {
  function testFunction() external pure returns (string memory) {
    return "B";
  }
}
