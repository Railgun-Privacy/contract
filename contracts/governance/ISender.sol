// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

interface ISender {
  function readyTask(uint256 _task) external returns (uint256);
}
