// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

contract ProxyTargetStubA {
  function identify() external pure returns (string memory) {
    return "A";
  }

  function transferOwnership(address _newOwner) external pure returns (string memory) {
    require(_newOwner == _newOwner, "Silence unused vars warning");
    return "Implementation";
  }

  function upgrade(address _newImplementation) external pure returns (string memory) {
    require(_newImplementation == _newImplementation, "Silence unused vars warning");
    return "Implementation";
  }

  function pause() external pure returns (string memory) {
    return "Implementation";
  }

  function unpause() external pure returns (string memory) {
    return "Implementation";
  }

  receive() external payable {}
}

contract ProxyTargetStubB {
  function identify() external pure returns (string memory) {
    return "B";
  }

  function transferOwnership(address _newOwner) external pure returns (string memory) {
    require(_newOwner == _newOwner, "Silence unused vars warning");
    return "Implementation";
  }

  function upgrade(address _newImplementation) external pure returns (string memory) {
    require(_newImplementation == _newImplementation, "Silence unused vars warning");
    return "Implementation";
  }

  function pause() external pure returns (string memory) {
    return "Implementation";
  }

  function unpause() external pure returns (string memory) {
    return "Implementation";
  }

  receive() external payable {}
}
