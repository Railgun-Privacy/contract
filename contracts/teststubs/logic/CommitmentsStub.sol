// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { Commitments } from "../../logic/Commitments.sol";

contract CommitmentsStub is Commitments {
  constructor() {
    initializeCommitmentsStub();
  }

  function doubleInit() external {
    Commitments.initializeCommitments();
  }

  function initializeCommitmentsStub() internal initializer {
    Commitments.initializeCommitments();
  }

  function insertLeavesStub(bytes32[] memory _leafHashes) external {
    Commitments.insertLeaves(_leafHashes);
  }

  function setNextLeafIndex(uint256 _index) external {
    Commitments.nextLeafIndex = _index;
  }
}
