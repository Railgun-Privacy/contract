// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

contract CrossDomainMessengerStub {
  address private sender;
  address private target;
  bytes private message;
  uint32 private minGasLimit;

  function xDomainMessageSender() external view returns (address) {
    return sender;
  }

  function setSender(address _sender) external {
    sender = _sender;
  }

  function callAs(
    address _sender,
    address _target,
    bytes memory _data
  ) external returns (bool, bytes memory) {
    sender = _sender;
    (bool success, bytes memory returnData) = _target.call(_data);
    return (success, returnData);
  }

  function sendMessage(
    address _target,
    bytes memory _message,
    uint32 _minGasLimit
  ) external payable {
    target = _target;
    message = _message;
    minGasLimit = _minGasLimit;
  }

  // Helper functions for testing
  function getLastMessageDetails() external view returns (address, bytes memory, uint32) {
    return (target, message, minGasLimit);
  }
}
