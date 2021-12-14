// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

import { Commitment, GeneratedCommitment } from "../../logic/Globals.sol";
import { RailgunLogic } from "../../logic/RailgunLogic.sol";
import { Commitments } from "../../logic/Commitments.sol";
import { PoseidonT6 } from "../../logic/Poseidon.sol";

contract RailgunLogicStub is RailgunLogic {
  function insertGeneratedCommitment(GeneratedCommitment calldata _commitment) external {
    // Insert commitments using the old events pattern for testing purposes
    uint256 hash = PoseidonT6.poseidon([
      _commitment.pubkey[0],
      _commitment.pubkey[1],
      _commitment.random,
      _commitment.amount,
      uint256(uint160(_commitment.token))
    ]);

    emit NewGeneratedCommitment({
      treeNumber: Commitments.treeNumber,
      position: Commitments.nextLeafIndex,
      hash: hash,
      pubkey: _commitment.pubkey,
      random: _commitment.random,
      amount: _commitment.amount,
      token: _commitment.token
    });

    uint256[] memory insertionLeaves = new uint256[](1);
    insertionLeaves[0] = hash;
    Commitments.insertLeaves(insertionLeaves);
  }

  function insertDummyCommitment(Commitment calldata _commitment) external {
    // Insert commitment using the old events pattern for testing purposes

    emit NewCommitment({
      treeNumber: Commitments.treeNumber,
      position: Commitments.nextLeafIndex,
      hash: _commitment.hash,
      ciphertext: _commitment.ciphertext,
      senderPubKey: _commitment.senderPubKey
    });

    uint256[] memory insertionLeaves = new uint256[](1);
    insertionLeaves[0] = _commitment.hash;
    Commitments.insertLeaves(insertionLeaves);
  }
}
