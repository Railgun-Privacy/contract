// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from  "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { CommitmentCiphertext, CommitmentPreimage, Transaction } from "./Globals.sol";

import { Uint80BitMap } from "./Uint80Bitmap.sol";

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
  using Uint80BitMap for uint80;

  // NOTE: The order of instantiation MUST stay the same across upgrades
  // add new variables to the bottom of the list
  // See https://docs.openzeppelin.com/learn/upgrading-smart-contracts#upgrading

  // Treasury variables
  address payable public treasury; // Treasury contract
  uint256 private constant BASIS_POINTS = 10000; // Number of basis points that equal 100%
  // % fee in 100ths of a %. 100 = 1%.
  uint256 public depositFee;
  uint256 public withdrawFee;

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
    CommitmentPreimage[] commitments
  );

  event Nullifiers(uint256 treeNumber, uint256[] nullifier);

  /**
   * @notice Initialize Railgun contract
   * @dev OpenZeppelin initializer ensures this can only be called once
   * This function also calls initializers on inherited contracts
   * @param _tokenBlacklist - Initial token blacklist to use
   * @param _treasury - address to send usage fees to
   * @param _depositFee - Deposit fee
   * @param _withdrawFee - Withdraw fee
   * @param _nftFee - Flat fee in wei that applies to NFT transactions
   * @param _owner - governance contract
   */
  function initializeRailgunLogic(
    uint256[] calldata _tokenBlacklist,
    address payable _treasury,
    uint256 _depositFee,
    uint256 _withdrawFee,
    uint256 _nftFee,
    address _owner
  ) external initializer {
    // Call initializers
    OwnableUpgradeable.__Ownable_init();
    Commitments.initializeCommitments();
    TokenBlacklist.initializeTokenBlacklist(_tokenBlacklist);

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
    uint256 _depositFee,
    uint256 _withdrawFee,
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
  function getFee(uint256 _amount, bool _isInclusive) public view returns (uint256, uint256) {
    // Base is the amount deposited into the railgun contract or withdrawn to the target eth address
    // for deposits and withdraws respectively
    uint256 base;
    // Fee is the amount sent to the treasury
    uint256 fee;

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
   * @notice Hashes a commitment
   * @param _commitmentPreimage - commitment to hash
   * @return commitment hash
   */
  function hashCommitment(CommitmentPreimage calldata _commitmentPreimage) public returns (uint256) {
    return PoseidonT4.poseidon([
      _commitmentPreimage.ypubkey,
      abi.encodePacked(
        _commitmentPreimage.sign,
        _commitmentPreimage.value,
        _commitmentPreimage.random
      ),
      _commitmentPreimage.token
    ]);
  }

  /**
   * @notice Execute batch of Railgun snark transactions
   * @param _transactions - Transactions to execute
   * @param _withdraws - Commitment preimages to withdraw
   * @param _withdrawOutputs - Overrides for withdraw destination
   */  
  function transact(
    Transaction[] calldata _transactions,
    CommitmentPreimage[] calldata _withdraws,
    address[] calldata _withdrawOutputOverrides
  ) external payable {
    // Accumulate total number of withdrawn commitments
    uint256 withdrawCommitmentCount = 0;

    // Loop through each transaction
    uint256 transactionLength = _transactions.length;
    for(uint256 transactionIter = 0; transactionIter < transactionLength; transactionIter++){
      // Retrieve transaction
      Transaction calldata transaction = _transactions[transactionIter];

      // If _adaptIDcontract is not zero check that it matches the caller
      require(
        transaction.boundParams.adaptIDcontract == address (0) || transaction.adaptIDcontract == msg.sender,
        "AdaptID doesn't match caller contract"
      );

      // Check merkle root is valid
      require(Commitments.rootHistory[transaction.treeNumber][transaction.merkleRoot], "RailgunLogic: Invalid Merkle Root");

      // Retrieve treeNumber
      uint256 treeNumber = transaction.boundParams.treeNumber;

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

      // Retrieve withdraw mask
      uint80 withdrawMask = transaction.boundParams.withdrawMask;

      // Loop through commitments and add relevant to withdraw queue
      uint256 commitmentsLength = transaction.commitments.length;
      for (uint256 commitmientsIter = 0; commitmientsIter < commitmentsLength; commitmientsIter++) {
        if (withdrawMask.getBit(commitmientsIter)) {
          // Hash the commitment
          uint256 commitmentHash = hashCommitment(_withdraws[withdrawCommitmentCount]);

          // Make sure the commitment hash matches the transaction output
          require(
            commitmentHash == transaction.commitments[commitmientsIter],
            "RailgunLogic: Withdraw commitment preimage is invalid"
          );

          // Get ERC20 interface
          IERC20 token = IERC20(address(uint160(transaction.token)));

          // Check if we've been asked to override the withdraw destination
          if(_withdrawOutputOverrides[withdrawCommitmentCount] != address(0)) {

          }

          // Increment counter of withdrawn commitments
          withdrawCommitmentCount++;
        }
      }
    }

    // Loop through each transaction
    for(uint256 transactionIter = 0; transactionIter < _transactions.length; transactionIter++){
    
      //add commitments to the struct
      for(uint256 commitmientsIter = 0; commitmientsIter < transaction.commitmentsOut.length; commitmientsIter++){
        // Throw if commitment hash is invalid
        require(
          transaction.commitmentsOut[commitmientsIter].hash < SNARK_SCALAR_FIELD,
          "Commitments: context.leafHash[] entries must be < SNARK_SCALAR_FIELD"
        );

        // Push hash to insertion array
        insertionLeaves[commitments] =  transaction.commitmentsOut[commitmientsIter].hash;

        // Push commitment to event array
        newCommitments[commitments] = transaction.commitmentsOut[commitmientsIter];
      }
    }

    // Emit commitment state update
    emit CommitmentBatch(Commitments.treeNumber, Commitments.nextLeafIndex, newCommitments);

    // Push new commitments to merkle free
    Commitments.insertLeaves(insertionLeaves);
  }

  /**
   * @notice Deposits requested amount and token, creates a commitment hash from supplied values and adds to tree
   * @dev This is for DeFi integrations where the resulting number of tokens to be added
   * can't be known in advance (eg. AMM trade where transaction ordering could cause token amounts to change)
   * @param _notes - list of commitments to generate
   */
  function generateDeposit(CommitmentPreimage[] calldata _notes) external payable {
    // Insertion and event arrays
    uint256[] memory insertionLeaves = new uint256[](_transactions.length);
    GeneratedCommitment[] memory generatedCommitments = new GeneratedCommitment[](_transactions.length);

    for (uint256 transactionIter = 0; transactionIter < _transactions.length; transactionIter++) {
      GenerateDepositTX calldata transaction = _transactions[transactionIter];

      // Check deposit amount is not 0
      require(transaction.amount > 0, "RailgunLogic: Cannot deposit 0 tokens");

      // Check if token is on the blacklist
      require(
        !TokenBlacklist.tokenBlacklist[transaction.token],
        "RailgunLogic: Token is blacklisted"
      );

      // Check _random is in snark scalar field
      require(transaction.random < SNARK_SCALAR_FIELD, "RailgunLogic: random out of range");

      // Check pubkey points are in snark scalar field
      require(transaction.pubkey[0] < SNARK_SCALAR_FIELD, "RailgunLogic: pubkey[0] out of range");
      require(transaction.pubkey[1] < SNARK_SCALAR_FIELD, "RailgunLogic: pubkey[1] out of range");

      // Calculate fee
      // Fee is in addition to deposit
      (, uint256 fee) = getBaseAndFee(transaction.amount, false);

      // Calculate commitment hash
      uint256 hash = PoseidonT4.poseidon([
        transaction.pubkey[0],
        transaction.pubkey[1],
        transaction.random,
        transaction.amount,
        uint256(uint160(transaction.token))
      ]);

      // Add to insertion array
      insertionLeaves[transactionIter] = hash;

      // Add GeneratedCommitment to event array
      generatedCommitments[transactionIter] = GeneratedCommitment({
        pubkey: transaction.pubkey,
        random: transaction.random,
        amount: transaction.amount,
        token: transaction.token
      });

      // Require tokenType and tokenSubID to be 0 here, replace with NFT and 1155 support
      require(transaction.tokenType == 0, "RailgunLogic: tokenType must be ERC20");
      require(transaction.tokenSubID == 0, "RailgunLogic: tokenSubID must be 0");

      // Get ERC20 interface
      IERC20 token = IERC20(address(uint160(transaction.token)));

      // Use OpenZeppelin safetransfer to revert on failure - https://github.com/ethereum/solidity/issues/4116
      token.safeTransferFrom(msg.sender, address(this), transaction.amount);

      // Transfer fee
      token.safeTransferFrom(msg.sender, treasury, fee);
    }

    // Emit GeneratedCommitmentAdded events (for wallets) for the commitments
    emit GeneratedCommitmentBatch(Commitments.treeNumber, Commitments.nextLeafIndex, generatedCommitments);

    // Push new commitments to merkle tree
    Commitments.insertLeaves(insertionLeaves);
  }
}
