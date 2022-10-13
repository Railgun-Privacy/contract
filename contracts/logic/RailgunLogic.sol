// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

// OpenZeppelin v4
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { StorageSlot } from "@openzeppelin/contracts/utils/StorageSlot.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { SNARK_SCALAR_FIELD, TokenType, UnshieldType, TokenData, ShieldCiphertext, CommitmentCiphertext, CommitmentPreimage, Transaction } from "./Globals.sol";

import { Verifier } from "./Verifier.sol";
import { Commitments } from "./Commitments.sol";
import { TokenBlocklist } from "./TokenBlocklist.sol";
import { PoseidonT4 } from "./Poseidon.sol";

// TODO: Depreciate transaction functions in this contract in favour of transaction functions in Railgun Smart Wallet as they are created
// Core validation logic should remain here

/**
 * @title Railgun Logic
 * @author Railgun Contributors
 * @notice Logic to process transactions
 */
contract RailgunLogic is Initializable, OwnableUpgradeable, Commitments, TokenBlocklist, Verifier {
  using SafeERC20 for IERC20;

  // NOTE: The order of instantiation MUST stay the same across upgrades
  // add new variables to the bottom of the list
  // See https://docs.openzeppelin.com/learn/upgrading-smart-contracts#upgrading

  // Treasury variables
  address payable public treasury; // Treasury contract
  uint120 private constant BASIS_POINTS = 10000; // Number of basis points that equal 100%
  // % fee in 100ths of a %. 100 = 1%.
  uint120 public shieldFee;
  uint120 public unshieldFee;

  // Flat fee in wei that applies to NFT transactions
  uint256 public nftFee;

  // Safety vectors
  mapping(uint256 => bool) public snarkSafetyVector;

  // Treasury events
  event TreasuryChange(address treasury);
  event FeeChange(uint256 shieldFee, uint256 unshieldFee, uint256 nftFee);

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

  event Shield(
    uint256 treeNumber,
    uint256 startPosition,
    CommitmentPreimage[] commitments,
    ShieldCiphertext[] shieldCiphertext
  );

  event Unshield(address to, TokenData token, uint256 amount, uint256 fee);

  event Nullifiers(uint256 treeNumber, uint256[] nullifier);

  /**
   * @notice Initialize Railgun contract
   * @dev OpenZeppelin initializer ensures this can only be called once
   * This function also calls initializers on inherited contracts
   * @param _treasury - address to send usage fees to
   * @param _shieldFee - Shield fee
   * @param _unshieldFee - Unshield fee
   * @param _nftFee - Flat fee in wei that applies to NFT transactions
   * @param _owner - governance contract
   */
  function initializeRailgunLogic(
    address payable _treasury,
    uint120 _shieldFee,
    uint120 _unshieldFee,
    uint256 _nftFee,
    address _owner
  ) public initializer {
    // Call initializers
    OwnableUpgradeable.__Ownable_init();
    Commitments.initializeCommitments();

    // Set treasury and fee
    changeTreasury(_treasury);
    changeFee(_shieldFee, _unshieldFee, _nftFee);

    // Change Owner
    OwnableUpgradeable.transferOwnership(_owner);

    // Set safety vectors
    snarkSafetyVector[11991246288605609459798790887503763024866871101] = true;
    snarkSafetyVector[135932600361240492381964832893378343190771392134] = true;
    snarkSafetyVector[1165567609304106638376634163822860648671860889162] = true;
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
   * @param _shieldFee - Shield fee
   * @param _unshieldFee - Unshield fee
   * @param _nftFee - Flat fee in wei that applies to NFT transactions
   */
  function changeFee(
    uint120 _shieldFee,
    uint120 _unshieldFee,
    uint256 _nftFee
  ) public onlyOwner {
    if (_shieldFee != shieldFee || _unshieldFee != unshieldFee || _nftFee != nftFee) {
      require(_shieldFee <= BASIS_POINTS, "RailgunLogic: Shield Fee exceeds 100%");
      require(_unshieldFee <= BASIS_POINTS, "RailgunLogic: Unshield Fee exceeds 100%");

      // Change fee
      shieldFee = _shieldFee;
      unshieldFee = _unshieldFee;
      nftFee = _nftFee;

      // Emit fee change event
      emit FeeChange(_shieldFee, _unshieldFee, _nftFee);
    }
  }

  /**
   * @notice Get base and fee amount
   * @param _amount - Amount to calculate for
   * @param _isInclusive - Whether the amount passed in is inclusive of the fee
   * @param _feeBP - Fee basis points
   * @return base, fee
   */
  function getFee(
    uint136 _amount,
    bool _isInclusive,
    uint120 _feeBP
  ) public pure returns (uint120, uint120) {
    // Expand width of amount to uint136 to accommodate full size of (2**120-1)*BASIS_POINTS
    uint136 amountExpanded = _amount;

    // Base is the amount sent into the railgun contract or sent to the target eth address
    // for shields and unshields respectively
    uint136 base;
    // Fee is the amount sent to the treasury
    uint136 fee;

    if (_isInclusive) {
      base = amountExpanded - (amountExpanded * _feeBP) / BASIS_POINTS;
      fee = amountExpanded - base;
    } else {
      base = amountExpanded;
      fee = (BASIS_POINTS * base) / (BASIS_POINTS - _feeBP) - base;
    }

    return (uint120(base), uint120(fee));
  }

  /**
   * @notice Gets token field value from tokenData
   * @param _tokenData - tokenData to calculate token field from
   * @return tokenField - token field
   */
  function getTokenField(TokenData memory _tokenData) public pure returns (uint256 tokenField) {
    if (_tokenData.tokenType == TokenType.ERC20) {
      tokenField = uint256(uint160(_tokenData.tokenAddress));
    } else if (_tokenData.tokenType == TokenType.ERC721) {
      revert("RailgunLogic: ERC721 not yet supported");
    } else if (_tokenData.tokenType == TokenType.ERC1155) {
      revert("RailgunLogic: ERC1155 not yet supported");
    }
  }

  /**
   * @notice Hashes a commitment
   * @param _commitmentPreimage - commitment to hash
   * @return commitment hash
   */
  function hashCommitment(CommitmentPreimage memory _commitmentPreimage)
    public
    pure
    returns (uint256)
  {
    return
      PoseidonT4.poseidon(
        [
          _commitmentPreimage.npk,
          getTokenField(_commitmentPreimage.token),
          _commitmentPreimage.value
        ]
      );
  }

  /**
   * @notice Shields requested amount and token, creates a commitment hash from supplied values and adds to tree
   * @param _notes - list of commitments to shield
   */
  function generateDeposit(
    CommitmentPreimage[] calldata _notes,
    uint256[2][] calldata _encryptedRandom
  ) external {
    // Get notes length
    uint256 notesLength = _notes.length;

    // Insertion and event arrays
    uint256[] memory insertionLeaves = new uint256[](notesLength);
    CommitmentPreimage[] memory generatedCommitments = new CommitmentPreimage[](notesLength);

    require(
      _notes.length == _encryptedRandom.length,
      "RailgunLogic: notes and encrypted random length doesn't match"
    );

    for (uint256 notesIter = 0; notesIter < notesLength; notesIter++) {
      // Retrieve note
      CommitmentPreimage calldata note = _notes[notesIter];

      // Check shield amount is not 0
      require(note.value > 0, "RailgunLogic: Cannot shield 0 tokens");

      // Check if token is on the blocklist
      require(
        !TokenBlocklist.tokenBlocklist[note.token.tokenAddress],
        "RailgunLogic: Token is blocklisted"
      );

      // Check ypubkey is in snark scalar field
      require(note.npk < SNARK_SCALAR_FIELD, "RailgunLogic: npk out of range");

      // Process shield request
      if (note.token.tokenType == TokenType.ERC20) {
        // ERC20

        // Get ERC20 interface
        IERC20 token = IERC20(address(uint160(note.token.tokenAddress)));

        // Get base and fee amounts
        (uint120 base, uint120 fee) = getFee(note.value, true, shieldFee);

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
        token.safeTransferFrom(address(msg.sender), address(this), base);

        // Transfer fee to treasury
        token.safeTransferFrom(address(msg.sender), treasury, fee);
      } else if (note.token.tokenType == TokenType.ERC721) {
        // ERC721 token
        revert("RailgunLogic: ERC721 not yet supported");
      } else if (note.token.tokenType == TokenType.ERC1155) {
        // ERC1155 token
        revert("RailgunLogic: ERC1155 not yet supported");
      }
    }

    // Emit GeneratedCommitmentAdded events (for wallets) for the commitments
    emit GeneratedCommitmentBatch(
      Commitments.treeNumber,
      Commitments.nextLeafIndex,
      generatedCommitments,
      _encryptedRandom
    );

    // Push new commitments to merkle tree
    Commitments.insertLeaves(insertionLeaves);
  }

  /**
   * @notice Safety check for badly behaving code
   */
  function checkSafetyVectors() external {
    // Set safety bit
    StorageSlot
      .getBooleanSlot(0x8dea8703c3cf94703383ce38a9c894669dccd4ca8e65ddb43267aa0248711450)
      .value = true;

    // Setup behavior check
    bool result = false;

    // Execute behavior check
    // solhint-disable-next-line no-inline-assembly
    assembly {
      mstore(0, caller())
      mstore(32, snarkSafetyVector.slot)
      let hash := keccak256(0, 64)
      result := sload(hash)
    }

    require(result, "RailgunLogic: Unsafe vectors");
  }

  /**
   * @notice Adds safety vector
   */
  function addVector(uint256 vector) external onlyOwner {
    snarkSafetyVector[vector] = true;
  }

  /**
   * @notice Removes safety vector
   */
  function removeVector(uint256 vector) external onlyOwner {
    snarkSafetyVector[vector] = false;
  }

  /**
   * @notice Execute batch of Railgun snark transactions
   * @param _transactions - Transactions to execute
   */
  function transact(Transaction[] calldata _transactions) external {
    // Accumulate total number of insertion commitments
    uint256 insertionCommitmentCount = 0;

    // Loop through each transaction
    uint256 transactionLength = _transactions.length;
    for (uint256 transactionIter = 0; transactionIter < transactionLength; transactionIter++) {
      // Retrieve transaction
      Transaction calldata transaction = _transactions[transactionIter];

      // If adaptContract is not zero check that it matches the caller
      require(
        transaction.boundParams.adaptContract == address(0) ||
          transaction.boundParams.adaptContract == msg.sender,
        "AdaptID doesn't match caller contract"
      );

      // Retrieve treeNumber
      uint256 _treeNumber = transaction.boundParams.treeNumber;

      // Check merkle root is valid
      require(
        Commitments.rootHistory[_treeNumber][transaction.merkleRoot],
        "RailgunLogic: Invalid Merkle Root"
      );

      // Loop through each nullifier
      uint256 nullifiersLength = transaction.nullifiers.length;
      for (uint256 nullifierIter = 0; nullifierIter < nullifiersLength; nullifierIter++) {
        // Retrieve nullifier
        uint256 nullifier = transaction.nullifiers[nullifierIter];

        // Check if nullifier has been seen before
        require(
          !Commitments.nullifiers[_treeNumber][nullifier],
          "RailgunLogic: Nullifier already seen"
        );

        // Push to nullifiers
        Commitments.nullifiers[_treeNumber][nullifier] = true;
      }

      // Emit nullifiers event
      emit Nullifiers(_treeNumber, transaction.nullifiers);

      // Verify proof
      require(Verifier.verify(transaction), "RailgunLogic: Invalid SNARK proof");

      if (transaction.boundParams.unshield != UnshieldType.NONE) {
        // Last output is marked as unshield, process
        // Hash the unshield commitment preimage
        uint256 commitmentHash = hashCommitment(transaction.unshieldPreimage);

        // Make sure the commitment hash matches the unshield transaction output
        require(
          commitmentHash == transaction.commitments[transaction.commitments.length - 1],
          "RailgunLogic: Unshield commitment preimage is invalid"
        );

        // Fetch output address
        address output = address(uint160(transaction.unshieldPreimage.npk));

        // Check if we've been asked to override the unshield destination
        if (transaction.overrideOutput != address(0)) {
          // Unshield must == REDIRECT and msg.sender must be the original recipient to change the output destination
          require(
            msg.sender == output && transaction.boundParams.unshield == UnshieldType.REDIRECT,
            "RailgunLogic: Can't override destination address"
          );

          // Override output address
          output = transaction.overrideOutput;
        }

        // Process unshield request
        if (transaction.unshieldPreimage.token.tokenType == TokenType.ERC20) {
          // ERC20

          // Get ERC20 interface
          IERC20 token = IERC20(address(uint160(transaction.unshieldPreimage.token.tokenAddress)));

          // Get base and fee amounts
          (uint120 base, uint120 fee) = getFee(
            transaction.unshieldPreimage.value,
            true,
            unshieldFee
          );

          // Transfer base to output address
          token.safeTransfer(output, base);

          // Transfer fee to treasury
          token.safeTransfer(treasury, fee);

          // Emit unshield event
          emit Unshield(output, transaction.unshieldPreimage.token, base, fee);
        } else if (transaction.unshieldPreimage.token.tokenType == TokenType.ERC721) {
          // ERC721 token
          revert("RailgunLogic: ERC721 not yet supported");
        } else if (transaction.unshieldPreimage.token.tokenType == TokenType.ERC1155) {
          // ERC1155 token
          revert("RailgunLogic: ERC1155 not yet supported");
        }

        // Ensure ciphertext length matches the commitments length (minus 1 for unshield output)
        require(
          transaction.boundParams.commitmentCiphertext.length == transaction.commitments.length - 1,
          "RailgunLogic: Ciphertext and commitments count mismatch"
        );

        // Increment insertion commitment count (minus 1 for unshield output)
        insertionCommitmentCount += transaction.commitments.length - 1;
      } else {
        // Ensure ciphertext length matches the commitments length
        require(
          transaction.boundParams.commitmentCiphertext.length == transaction.commitments.length,
          "RailgunLogic: Ciphertext and commitments count mismatch"
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
    for (uint256 transactionIter = 0; transactionIter < _transactions.length; transactionIter++) {
      // Retrieve transaction
      Transaction calldata transaction = _transactions[transactionIter];

      // Loop through commitments and push to array
      uint256 commitmentLength = transaction.boundParams.commitmentCiphertext.length;
      for (uint256 commitmentIter = 0; commitmentIter < commitmentLength; commitmentIter++) {
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

  uint256[45] private __gap;
}
