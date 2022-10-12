// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

// OpenZeppelin v4
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { RailgunLogic, TokenBlocklist, Commitments } from "./RailgunLogic.sol";

import { SNARK_SCALAR_FIELD, CommitmentPreimage, DepositCiphertext, TokenType } from "./Globals.sol";

/**
 * @title Railgun Smart Wallet
 * @author Railgun Contributors
 * @notice Railgun private smart wallet
 * @dev Entry point for processing private meta-transactions
 */
contract RailgunSmartWallet is RailgunLogic {
  using SafeERC20 for IERC20;

  /**
   * @notice Deposits requested amount and token, creates a commitment hash from supplied values and adds to tree
   * @param _notes - list of commitments to deposit
   * @param _depositCiphertext - ciphertext of deposited notes
   */
  function deposit(
    CommitmentPreimage[] calldata _notes,
    DepositCiphertext[] calldata _depositCiphertext
  ) external {
    // Get notes length
    uint256 notesLength = _notes.length;

    // Insertion and event arrays
    uint256[] memory insertionLeaves = new uint256[](notesLength);
    CommitmentPreimage[] memory commitments = new CommitmentPreimage[](notesLength);

    require(
      _notes.length == _depositCiphertext.length,
      "RailgunSmartWallet: notes and deposit ciphertext length doesn't match"
    );

    for (uint256 notesIter = 0; notesIter < notesLength; notesIter++) {
      // Retrieve note
      CommitmentPreimage calldata note = _notes[notesIter];

      // Check deposit amount is not 0
      require(note.value > 0, "RailgunSmartWallet: Cannot deposit 0 tokens");

      // Check if token is on the blocklist
      require(
        !TokenBlocklist.tokenBlocklist[note.token.tokenAddress],
        "RailgunSmartWallet: Token is blocklisted"
      );

      // Check ypubkey is in snark scalar field
      require(note.npk < SNARK_SCALAR_FIELD, "RailgunSmartWallet: npk out of range");

      // Process deposit request
      if (note.token.tokenType == TokenType.ERC20) {
        // ERC20

        // Get ERC20 interface
        IERC20 token = IERC20(address(uint160(note.token.tokenAddress)));

        // Get base and fee amounts
        (uint120 base, uint120 fee) = getFee(note.value, true, depositFee);

        // Add GeneratedCommitment to event array
        commitments[notesIter] = CommitmentPreimage({
          npk: note.npk,
          value: base,
          token: note.token
        });

        // Calculate commitment hash
        uint256 hash = hashCommitment(commitments[notesIter]);

        // Add to insertion array
        insertionLeaves[notesIter] = hash;

        // Transfer base to output address
        token.safeTransferFrom(address(msg.sender), address(this), base);

        // Transfer fee to treasury
        token.safeTransferFrom(address(msg.sender), treasury, fee);
      } else if (note.token.tokenType == TokenType.ERC721) {
        // ERC721 token
        revert("RailgunSmartWallet: ERC721 not yet supported");
      } else if (note.token.tokenType == TokenType.ERC1155) {
        // ERC1155 token
        revert("RailgunSmartWallet: ERC1155 not yet supported");
      }
    }

    // Emit Deposit events (for wallets) for the commitments
    emit Deposit(
      Commitments.treeNumber,
      Commitments.nextLeafIndex,
      commitments,
      _depositCiphertext
    );

    // Push new commitments to merkle tree
    Commitments.insertLeaves(insertionLeaves);
  }
}
