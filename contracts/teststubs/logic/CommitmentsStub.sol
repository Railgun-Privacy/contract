// SPDX-License-Identifier: UNLICENSED
pragma abicoder v2;
pragma solidity ^0.8.0;

import { Commitment } from "../../logic/Types.sol";
import { Commitments } from "../../logic/Commitments.sol";

contract CommitmentsStub is Commitments {
  function initializeCommitmentsStub() external {
    Commitments.initializeCommitments();
  }

  function addCommitmentsStub(Commitment[] calldata _commitments) external {
    addCommitments(_commitments);
  }

  function addGeneratedCommitmentStub(
    uint256[2] calldata pubkey,
    uint256 serial,
    uint256 amount,
    address token
  ) external {
    addGeneratedCommitment(pubkey, serial, amount, token);
  }
}
