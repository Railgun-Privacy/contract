// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

contract ArbInboxStub {
  address public to;
  uint256 public arbTxCallValue;
  uint256 public maxSubmissionCost;
  address public submissionRefundAddress;
  address public valueRefundAddress;
  uint256 public gasLimit;
  uint256 public maxFeePerGas;
  bytes public data;

  uint256 public ticketID;

  function calculateRetryableSubmissionFee(
    uint256 dataLength,
    uint256 baseFee
  ) public pure returns (uint256) {
    return baseFee * 2 + dataLength * 0; // multiply by 0 to silence unused variable warning
  }

  function createRetryableTicket(
    address _to,
    uint256 _arbTxCallValue,
    uint256 _maxSubmissionCost,
    address _submissionRefundAddress,
    address _valueRefundAddress,
    uint256 _gasLimit,
    uint256 _maxFeePerGas,
    bytes calldata _data
  ) external payable returns (uint256) {
    require(
      _maxSubmissionCost >= calculateRetryableSubmissionFee(_data.length, block.basefee),
      "_maxSubmissionCost too low"
    );

    require(msg.value == _maxSubmissionCost, "msg.value wrong");

    to = _to;
    arbTxCallValue = _arbTxCallValue;
    maxSubmissionCost = _maxSubmissionCost;
    submissionRefundAddress = _submissionRefundAddress;
    valueRefundAddress = _valueRefundAddress;
    gasLimit = _gasLimit;
    maxFeePerGas = _maxFeePerGas;
    data = _data;

    return ticketID;
  }

  function getData()
    external
    view
    returns (address, uint256, uint256, address, address, uint256, uint256, bytes memory)
  {
    return (
      to,
      arbTxCallValue,
      maxSubmissionCost,
      submissionRefundAddress,
      valueRefundAddress,
      gasLimit,
      maxFeePerGas,
      data
    );
  }

  function setTicketID(uint256 _newID) external {
    ticketID = _newID;
  }
}
