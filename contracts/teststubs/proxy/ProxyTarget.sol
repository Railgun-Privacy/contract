// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

contract ProxyTargetStubA {
  function identify() external pure returns (string memory) {
    return "A";
  }

  // solhint-disable-next-line no-unused-vars
  function transferOwnership(address _newOwner) external pure returns (string memory) {
    return "Implementation";
  }

  // solhint-disable-next-line no-unused-vars
  function upgrade(address _newImplementation) external pure returns (string memory) {
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

  // solhint-disable-next-line no-unused-vars
  function transferOwnership(address _newOwner) external pure returns (string memory) {
    return "Implementation";
  }

  // solhint-disable-next-line no-unused-vars
  function upgrade(address _newImplementation) external pure returns (string memory) {
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
