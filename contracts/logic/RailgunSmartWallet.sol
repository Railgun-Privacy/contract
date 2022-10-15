// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { TokenBlocklist } from "./TokenBlocklist.sol";
import { Commitments } from "./Commitments.sol";
import { RailgunLogic } from "./RailgunLogic.sol";
import { SNARK_SCALAR_FIELD, CommitmentPreimage, CommitmentCiphertext, ShieldCiphertext, TokenType, UnshieldType, Transaction } from "./Globals.sol";

/**
 * @title Railgun Smart Wallet
 * @author Railgun Contributors
 * @notice Railgun private smart wallet
 * @dev Entry point for processing private meta-transactions
 */
contract RailgunSmartWallet is RailgunLogic {
  /**
   * @notice Shields requested amount and token, creates a commitment hash from supplied values and adds to tree
   * @param _notes - list of commitments to shield
   * @param _shieldCiphertext - ciphertext of notes
   */
  function shield(
    CommitmentPreimage[] calldata _notes,
    ShieldCiphertext[] calldata _shieldCiphertext
  ) external payable {
    // Get notes length
    uint256 notesLength = _notes.length;

    // Insertion and event arrays
    bytes32[] memory insertionLeaves = new bytes32[](notesLength);
    CommitmentPreimage[] memory commitments = new CommitmentPreimage[](notesLength);

    // Notes and ciphertext arrays must match
    require(
      _notes.length == _shieldCiphertext.length,
      "RailgunSmartWallet: Notes and shield ciphertext length doesn't match"
    );

    // Loop through each note and process
    for (uint256 notesIter = 0; notesIter < notesLength; notesIter++) {
      // Check note is valid
      require(
        RailgunLogic.validateCommitmentPreimage(_notes[notesIter]),
        "RailgunSmartWallet: Note is invalid"
      );

      // Process shield request and store adjusted note
      commitments[notesIter] = RailgunLogic.transferTokenIn(_notes[notesIter]);

      // Hash note for merkle tree insertion
      insertionLeaves[notesIter] = RailgunLogic.hashCommitment(_notes[notesIter]);
    }

    // Emit Shield events (for wallets) for the commitments
    emit Shield(Commitments.treeNumber, Commitments.nextLeafIndex, commitments, _shieldCiphertext);

    // Push new commitments to merkle tree
    Commitments.insertLeaves(insertionLeaves);
  }

  /**
   * @notice Execute batch of Railgun snark transactions
   * @param _transactions - Transactions to execute
   */
  function transact(Transaction[] calldata _transactions) external payable {
    uint256 commitmentsCount = RailgunLogic.sumCommitments(_transactions);

    // Create accumulators
    bytes32[] memory commitments = new bytes32[](commitmentsCount);
    uint256 commitmentsStartOffset = 0;
    CommitmentCiphertext[] memory ciphertext = new CommitmentCiphertext[](commitmentsCount);

    // Loop through each transaction
    for (uint256 transactionIter = 0; transactionIter < _transactions.length; transactionIter++) {
      // Validate transaction
      require(
        RailgunLogic.validateTransaction(_transactions[transactionIter]),
        "RailgunSmartWallet: Transaction isn't valid"
      );

      // Nullify, accumulate, and update offset
      commitmentsStartOffset = RailgunLogic.accumulateAndNullifyTransaction(
        _transactions[transactionIter],
        commitments,
        commitmentsStartOffset,
        ciphertext
      );

      // If unshield is specified, process
      RailgunLogic.transferTokenOut(
        _transactions[transactionIter].unshieldPreimage,
        _transactions[transactionIter].commitments[
          _transactions[transactionIter].commitments.length - 1
        ],
        _transactions[transactionIter].boundParams.unshield == UnshieldType.REDIRECT
      );
    }

    // Get insertion parameters
    (
      uint256 insertionTreeNumber,
      uint256 insertionStartIndex
    ) = getInsertionTreeNumberAndStartingIndex(commitments.length);

    // Emit commitment state update
    emit Transact(insertionTreeNumber, insertionStartIndex, commitments, ciphertext);

    // Push commitments to tree after events due to insertLeaves causing side effects
    Commitments.insertLeaves(commitments);
  }
}
