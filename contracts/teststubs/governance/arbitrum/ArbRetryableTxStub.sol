// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

contract ArbRetryableTxStub {
  function getLifetime() external pure returns (uint256) {
    return 14 days;
  }

  function getTimeout(bytes32 _id) external pure returns (uint256) {
    return uint256(keccak256(abi.encodePacked(_id)));
  }

  function redeem(bytes32 _id) external pure returns (bytes32) {
    return _id;
  }
}
