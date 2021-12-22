// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

import { Commitments } from "../../logic/Commitments.sol";

contract CommitmentsStub is Commitments {
  function initializeCommitmentsStub() external {
    Commitments.initializeCommitments();
  }

  function insertLeavesStub(uint256[] memory _leafHashes) external {
    Commitments.insertLeaves(_leafHashes);
  }
}
