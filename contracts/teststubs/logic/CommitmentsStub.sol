// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

import { Commitment, CIRCUIT_OUTPUTS } from "../../logic/Globals.sol";
import { Commitments } from "../../logic/Commitments.sol";

contract CommitmentsStub is Commitments {
  function initializeCommitmentsStub() external {
    Commitments.initializeCommitments();
  }

  function addCommitmentsStub(Commitment[CIRCUIT_OUTPUTS] calldata _commitments) external {
    addCommitments(_commitments);
  }

  function addGeneratedCommitmentStub(
    uint256[2] calldata pubkey,
    uint256 random,
    uint256 amount,
    address token
  ) external {
    addGeneratedCommitment(pubkey, random, amount, token);
  }
}
