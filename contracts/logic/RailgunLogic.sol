// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from  "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { SNARK_SCALAR_FIELD, TokenData, CommitmentCiphertext, CommitmentPreimage, Transaction } from "./Globals.sol";

import { Verifier } from "./Verifier.sol";
import { Commitments } from "./Commitments.sol";
import { TokenBlacklist } from "./TokenBlacklist.sol";
import { PoseidonT4 } from "./Poseidon.sol";

/**
 * @title Railgun Logic
 * @author Railgun Contributors
 * @notice Functions to interact with the railgun contract
 * @dev Wallets for Railgun will only need to interact with functions specified in this contract.
 * This contract is written to be run behind a ERC1967-like proxy. Upon deployment of proxy the _data parameter should
 * call the initializeRailgunLogic function.
 */
contract RailgunLogic is Initializable, OwnableUpgradeable, Commitments, TokenBlacklist, Verifier {
  using SafeERC20 for IERC20;

  // NOTE: The order of instantiation MUST stay the same across upgrades
  // add new variables to the bottom of the list
  // See https://docs.openzeppelin.com/learn/upgrading-smart-contracts#upgrading

  // Treasury variables
  address payable public treasury; // Treasury contract
  uint120 private constant BASIS_POINTS = 10000; // Number of basis points that equal 100%
  // % fee in 100ths of a %. 100 = 1%.
  uint120 public depositFee;
  uint120 public withdrawFee;

  // Flat fee in wei that applies to NFT transactions
  uint256 public nftFee;

  // Treasury events
  event TreasuryChange(address treasury);
  event FeeChange(uint256 depositFee, uint256 withdrawFee, uint256 nftFee);

  // Transaction events
  event CommitmentBatch(
    uint256 treeNumber,
    uint256 startPosition,
    uint256[] hash,
    CommitmentCiphertext[] ciphertext
  );

  event GeneratedCommitmentBatch(
    uint256 treeNumber,
    uint256 startPosition,
    CommitmentPreimage[] commitments,
    uint256[2][] encryptedRandom
  );

  event Nullifiers(uint256 treeNumber, uint256[] nullifier);

  /**
   * @notice Initialize Railgun contract
   * @dev OpenZeppelin initializer ensures this can only be called once
   * This function also calls initializers on inherited contracts
   * @param _treasury - address to send usage fees to
   * @param _depositFee - Deposit fee
   * @param _withdrawFee - Withdraw fee
   * @param _nftFee - Flat fee in wei that applies to NFT transactions
   * @param _owner - governance contract
   */
  function initializeRailgunLogic(
    address payable _treasury,
    uint120 _depositFee,
    uint120 _withdrawFee,
    uint256 _nftFee,
    address _owner
  ) external initializer {
    // Call initializers
    OwnableUpgradeable.__Ownable_init();
    Commitments.initializeCommitments();

    // Set treasury and fee
    changeTreasury(_treasury);
    changeFee(_depositFee, _withdrawFee, _nftFee);

    // Change Owner
    OwnableUpgradeable.transferOwnership(_owner);
  }

  /**
   * @notice Change treasury address, only callable by owner (governance contract)
   * @dev This will change the address of the contract we're sending the fees to in the future
   * it won't transfer tokens already in the treasury
   * @param _treasury - Address of new treasury contract
   */
  function changeTreasury(address payable _treasury) public onlyOwner {
    // Do nothing if the new treasury address is same as the old
    if (treasury != _treasury) {
      // Change treasury
      treasury = _treasury;

      // Emit treasury change event
      emit TreasuryChange(_treasury);
    }
  }

  /**
   * @notice Change fee rate for future transactions
   * @param _depositFee - Deposit fee
   * @param _withdrawFee - Withdraw fee
   * @param _nftFee - Flat fee in wei that applies to NFT transactions
   */
  function changeFee(
    uint120 _depositFee,
    uint120 _withdrawFee,
    uint256 _nftFee
  ) public onlyOwner {
    if (
      _depositFee != depositFee
      || _withdrawFee != withdrawFee
      || nftFee != _nftFee
    ) {
      // Change fee
      depositFee = _depositFee;
      withdrawFee = _withdrawFee;
      nftFee = _nftFee;

      // Emit fee change event
      emit FeeChange(_depositFee, _withdrawFee, _nftFee);
    }
  }

  /**
   * @notice Get base and fee amount
   * @param _amount - Amount to calculate
   * @param _isInclusive - Whether the amount passed in is inclusive of the fee
   * @return base, fee
   */
  function getFee(uint120 _amount, bool _isInclusive) public view returns (uint120, uint120) {
    // Base is the amount deposited into the railgun contract or withdrawn to the target eth address
    // for deposits and withdraws respectively
    uint120 base;
    // Fee is the amount sent to the treasury
    uint120 fee;

    if (_isInclusive) {
      base = _amount * BASIS_POINTS / (BASIS_POINTS + withdrawFee);
      fee = _amount - base;
    } else {
      fee = _amount * depositFee / BASIS_POINTS;
      base = _amount;
    }

    return (base, fee);
  }

  /**
   * @notice Gets token field value from tokenData
   * @param _tokenData - tokenData to calculate token field from
   * @return token field
   */
  function getTokenField(TokenData memory _tokenData) public pure returns (uint256) {
    if (_tokenData.tokenType == 0) {
      return uint256(uint160(_tokenData.tokenAddress));
    } else if (_tokenData.tokenType == 1) {
      revert("RailgunLogic: ERC721 not yet supported");
    } else if (_tokenData.tokenType == 2) {
      revert("RailgunLogic: ERC1155 not yet supported");
    } else {
      revert("RailgunLogic: Unknown token type");
    }
  }

  /**
   * @notice Hashes a commitment
   * @param _commitmentPreimage - commitment to hash
   * @return commitment hash
   */
  function hashCommitment(CommitmentPreimage memory _commitmentPreimage) public pure returns (uint256) {
    return PoseidonT4.poseidon([
      _commitmentPreimage.npk,
      getTokenField(_commitmentPreimage.token),
      _commitmentPreimage.value
    ]);
  }

  /**
   * @notice Execute batch of Railgun snark transactions
   * @param _transactions - Transactions to execute
   */
  function transact(
    Transaction[] calldata _transactions
  ) external payable {
    // Accumulate total number of insertion commitments
    uint256 insertionCommitmentCount = 0;

    // Loop through each transaction
    uint256 transactionLength = _transactions.length;
    for(uint256 transactionIter = 0; transactionIter < transactionLength; transactionIter++) {
      // Retrieve transaction
      Transaction calldata transaction = _transactions[transactionIter];

      // If adaptContract is not zero check that it matches the caller
      require(
        transaction.boundParams.adaptContract == address (0) || transaction.boundParams.adaptContract == msg.sender,
        "AdaptID doesn't match caller contract"
      );

      // Retrieve treeNumber
      uint256 treeNumber = transaction.boundParams.treeNumber;

      // Check merkle root is valid
      require(Commitments.rootHistory[treeNumber][transaction.merkleRoot], "RailgunLogic: Invalid Merkle Root");

      // Loop through each nullifier
      uint256 nullifiersLength = transaction.nullifiers.length;
      for (uint256 nullifierIter = 0; nullifierIter < nullifiersLength; nullifierIter++) {
        // Retrieve nullifier
        uint256 nullifier = transaction.nullifiers[nullifierIter];

        // Check if nullifier has been seen before
        require(!Commitments.nullifiers[treeNumber][nullifier], "RailgunLogic: Nullifier already seen");

        // Push to nullifiers
        Commitments.nullifiers[treeNumber][nullifier] = true;
      }

      // Emit nullifiers event
      emit Nullifiers(treeNumber, transaction.nullifiers);

      // Verify proof
      require(
        Verifier.verify(transaction),
        "RailgunLogic: Invalid SNARK proof"
      );

      if (transaction.boundParams.withdraw > 0) {
        // First output is marked as withdraw, process
        // Hash the withdraw commitment preimage
        uint256 commitmentHash = hashCommitment(transaction.withdrawPreimage);

        // Make sure the commitment hash matches the withdraw transaction output
        require(
          commitmentHash == transaction.commitments[transaction.commitments.length - 1],
          "RailgunLogic: Withdraw commitment preimage is invalid"
        );

        // Fetch output address
        address output = address(uint160(transaction.withdrawPreimage.npk));

        // Check if we've been asked to override the withdraw destination
        if(transaction.overrideOutput != address(0)) {
          // Withdraw must == 2 and msg.sender must be the original recepient to change the output destination
          require(
            msg.sender == output && transaction.boundParams.withdraw == 2,
            "RailgunLogic: Can't override destination address"
          );

          // Override output address
          output = transaction.overrideOutput;
        }

        // Process withdrawal request
        if (transaction.withdrawPreimage.token.tokenType == 0) {
          // ERC20
          require(msg.value == 0, "RailgunLogic: Preventing accidentally sending unnecessary ETH fee");

          // Get ERC20 interface
          IERC20 token = IERC20(address(uint160(transaction.withdrawPreimage.token.tokenAddress)));

          // Get base and fee amounts
          (uint256 base, uint256 fee) = getFee(transaction.withdrawPreimage.value, true);

          // Transfer base to output address
          token.safeTransfer(
            output,
            base
          );

          // Transfer fee to treasury
          token.safeTransfer(
            treasury,
            fee
          );
        } else if (transaction.withdrawPreimage.token.tokenType == 1) {
          // ERC721 token
          revert("RailgunLogic: ERC721 not yet supported");
        } else if (transaction.withdrawPreimage.token.tokenType == 2) {
          // ERC1155 token
          revert("RailgunLogic: ERC1155 not yet supported");
        } else {
          // Invalid token type, revert
          revert("RailgunLogic: Unknown token type");
        }

        // Ensure ciphertext length matches the commitments length (minus 1 for withdrawn output)
        require(
          transaction.boundParams.commitmentCiphertext.length == transaction.commitments.length - 1,
          "RailgunLogic: Ciphertexts and commitments count mismatch"
        );

        // Increment insertion commitment count (minus 1 for withdrawn output)
        insertionCommitmentCount += transaction.commitments.length - 1;
      } else {
        // Ensure ciphertext length matches the commitments length
        require(
          transaction.boundParams.commitmentCiphertext.length == transaction.commitments.length,
          "RailgunLogic: Ciphertexts and commitments count mismatch"
        );

        // Increment insertion commitment count
        insertionCommitmentCount += transaction.commitments.length;
      }
    }

    // Create insertion array
    uint256[] memory hashes = new uint256[](insertionCommitmentCount);

    // Create ciphertext array
    CommitmentCiphertext[] memory ciphertext = new CommitmentCiphertext[](insertionCommitmentCount);

    // Track insert position
    uint256 insertPosition = 0;

    // Loop through each transaction and accumulate commitments
    for(uint256 transactionIter = 0; transactionIter < _transactions.length; transactionIter++) {
      // Retrieve transaction
      Transaction calldata transaction = _transactions[transactionIter];

      // Loop through commitments and push to array
      uint256 commitmentLength = transaction.boundParams.commitmentCiphertext.length;
      for(uint256 commitmentIter = 0; commitmentIter < commitmentLength; commitmentIter++) {
        // Push commitment hash to array
        hashes[insertPosition] = transaction.commitments[commitmentIter];

        // Push ciphertext to array
        ciphertext[insertPosition] = transaction.boundParams.commitmentCiphertext[commitmentIter];

        // Increment insert position
        insertPosition++;
      }
    }

    // Emit commitment state update
    emit CommitmentBatch(Commitments.treeNumber, Commitments.nextLeafIndex, hashes, ciphertext);

    // Push new commitments to merkle tree after event due to insertLeaves causing side effects
    Commitments.insertLeaves(hashes);
  }

  /**
   * @notice Deposits requested amount and token, creates a commitment hash from supplied values and adds to tree
   * @param _notes - list of commitments to deposit
   */
  function generateDeposit(CommitmentPreimage[] calldata _notes, uint256[2][] calldata encryptedRandom) external payable {
    // Get notes length
    uint256 notesLength = _notes.length;

    // Insertion and event arrays
    uint256[] memory insertionLeaves = new uint256[](notesLength);
    CommitmentPreimage[] memory generatedCommitments = new CommitmentPreimage[](notesLength);

    for (uint256 notesIter = 0; notesIter < notesLength; notesIter++) {
      // Retrieve note
      CommitmentPreimage calldata note = _notes[notesIter];

      // Check deposit amount is not 0
      require(note.value > 0, "RailgunLogic: Cannot deposit 0 tokens");

      // Check if token is on the blacklist
      require(
        !TokenBlacklist.tokenBlacklist[note.token.tokenAddress],
        "RailgunLogic: Token is blacklisted"
      );

      // Check ypubkey is in snark scalar field
      require(note.npk < SNARK_SCALAR_FIELD, "RailgunLogic: npk out of range");

      // Process deposit request
      if (note.token.tokenType == 0) {
        // ERC20
        require(msg.value == 0, "RailgunLogic: Preventing accidentally sending unnecessary ETH fee");

        // Get ERC20 interface
        IERC20 token = IERC20(address(uint160(note.token.tokenAddress)));

        // Get base and fee amounts
        (uint120 base, uint120 fee) = getFee(note.value, true);

        // Add GeneratedCommitment to event array
        generatedCommitments[notesIter] = CommitmentPreimage({
          npk: note.npk,
          value: base,
          token: note.token
        });

        // Calculate commitment hash
        uint256 hash = hashCommitment(generatedCommitments[notesIter]);

        // Add to insertion array
        insertionLeaves[notesIter] = hash;

        // Transfer base to output address
        token.safeTransferFrom(
          address(msg.sender),
          address(this),
          base
        );

        // Transfer fee to treasury
        token.safeTransferFrom(
          address(msg.sender),
          treasury,
          fee
        );
      } else if (note.token.tokenType == 1) {
        // ERC721 token
        revert("RailgunLogic: ERC721 not yet supported");
      } else if (note.token.tokenType == 2) {
        // ERC1155 token
        revert("RailgunLogic: ERC1155 not yet supported");
      } else {
        // Invalid token type, revert
        revert("RailgunLogic: Unknown token type");
      }
    }

    // Emit GeneratedCommitmentAdded events (for wallets) for the commitments
    emit GeneratedCommitmentBatch(Commitments.treeNumber, Commitments.nextLeafIndex, generatedCommitments, encryptedRandom);

    // Push new commitments to merkle tree
    Commitments.insertLeaves(insertionLeaves);
  }
}
