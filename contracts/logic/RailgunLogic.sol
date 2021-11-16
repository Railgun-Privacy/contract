// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from  "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { Transaction, VerifyingKey, SnarkProof, Commitment, GeneratedCommitment, SNARK_SCALAR_FIELD, CIPHERTEXT_WORDS, CIRCUIT_OUTPUTS } from "./Globals.sol";

import { Verifier } from "./Verifier.sol";
import { Commitments } from "./Commitments.sol";
import { TokenWhitelist } from "./TokenWhitelist.sol";
import { PoseidonT6 } from "./Poseidon.sol";

/**
 * @title Railgun Logic
 * @author Railgun Contributors
 * @notice Functions to interact with the railgun contract
 * @dev Wallets for Railgun will only need to interact with functions specified in this contract.
 * This contract is written to be run behind a ERC1967-like proxy. Upon deployment of proxy the _data parameter should
 * call the initializeRailgunLogic function.
 */

contract RailgunLogic is Initializable, OwnableUpgradeable, Commitments, TokenWhitelist, Verifier {
  using SafeERC20 for IERC20;

  uint256 private constant MAX_DEPOSIT_WITHDRAW = 2**120;

  // NOTE: The order of instantiation MUST stay the same across upgrades
  // add new variables to the bottom of the list
  // See https://docs.openzeppelin.com/learn/upgrading-smart-contracts#upgrading

  // Treasury variables
  address payable public treasury; // Treasury contract
  uint256 private constant BASIS_POINTS = 10000; // Number of basis points that equal 100%
  // % fee in 100ths of a %. 100 = 1%.
  uint256 public depositFee;
  uint256 public withdrawFee;

  // Flat fee in wei that applies to all transactions
  uint256 public transferFee;

  // Treasury events
  event TreasuryChange(address treasury);
  event FeeChange(uint256 depositFee, uint256 withdrawFee, uint256 transferFee);

  // Transaction events
  event CommitmentBatch(
    uint256 indexed treeNumber,
    uint256 indexed startPosition,
    Commitment[] commitments
  );

  event GeneratedCommitmentBatch(
    uint256 indexed treeNumber,
    uint256 indexed startPosition,
    GeneratedCommitment[] commitments
  );

  event Nullifier(uint256 indexed nullifier);

  /**
   * @notice Initialize Railgun contract
   * @dev OpenZeppelin initializer ensures this can only be called once
   * This function also calls initializers on inherited contracts
   * @param _tokenWhitelist - Initial token whitelist to use
   * @param _treasury - address to send usage fees to
   * @param _depositFee - Deposit fee
   * @param _withdrawFee - Withdraw fee
   * @param _transferFee - Flat fee that applies to all transactions
   * @param _owner - governance contract
   */

  function initializeRailgunLogic(
    VerifyingKey calldata _vKeySmall,
    VerifyingKey calldata _vKeyLarge,
    address[] calldata _tokenWhitelist,
    address payable _treasury,
    uint256 _depositFee,
    uint256 _withdrawFee,
    uint256 _transferFee,
    address _owner
  ) external initializer {
    // Call initializers
    OwnableUpgradeable.__Ownable_init();
    Commitments.initializeCommitments();
    TokenWhitelist.initializeTokenWhitelist(_tokenWhitelist);
    Verifier.initializeVerifier(_vKeySmall, _vKeyLarge);

    // Set treasury and fee
    changeTreasury(_treasury);
    changeFee(_depositFee, _withdrawFee, _transferFee);

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
   * @param _transferFee - Flat fee that applies to all transactions
   */

  function changeFee(
    uint256 _depositFee,
    uint256 _withdrawFee,
    uint256 _transferFee
  ) public onlyOwner {
    if (
      _depositFee != depositFee
      || _withdrawFee != withdrawFee
      || _transferFee != transferFee
    ) {
      // Change fee
      depositFee = _depositFee;
      withdrawFee = _withdrawFee;
      transferFee = _transferFee;

      // Emit fee change event
      emit FeeChange(_depositFee, _withdrawFee, _transferFee);
    }
  }

  function transact(Transaction[] calldata _transactions) external payable {
    // Check treasury fee is paid
    require(msg.value >= transferFee, "RailgunLogic: Fee not paid");

    // Transfer to treasury
    (bool sent,) = treasury.call{value: msg.value}("");
    require(sent, "Failed to send Ether");

    // Insertion array
    uint256[] memory insertionLeaves = new uint256[](_transactions.length * CIRCUIT_OUTPUTS);

    // Commitment event
    Commitment[] memory newCommitments = new Commitment[](_transactions.length * CIRCUIT_OUTPUTS);

    // Track count of commitments
    uint256 commitments = 0;

    // Loop through each transaction
    for(uint256 transactionIter = 0; transactionIter < _transactions.length; transactionIter++){
      // Retrieve transaction
      Transaction calldata transaction = _transactions[transactionIter];

      // If _adaptIDcontract is not zero check that it matches the caller
      require(transaction._adaptIDcontract == address (0) || transaction._adaptIDcontract == msg.sender, "AdaptID doesn't match caller contract");

      // Check merkle root is valid
      require(Commitments.rootHistory[transaction._treeNumber][transaction._merkleRoot], "RailgunLogic: Invalid Merkle Root");

      // Check depositAmount and withdrawAmount are below max allowed value
      require(transaction._depositAmount < MAX_DEPOSIT_WITHDRAW, "RailgunLogic: depositAmount too high");
      require(transaction._withdrawAmount < MAX_DEPOSIT_WITHDRAW, "RailgunLogic: withdrawAmount too high");

      // If deposit amount is not 0, token should be on whitelist
      // address(0) is wildcard (disables whitelist)
      require(
        transaction._depositAmount == 0 ||
        TokenWhitelist.tokenWhitelist[transaction._tokenField] ||
        TokenWhitelist.tokenWhitelist[address(0)],
        "RailgunLogic: Token isn't whitelisted for deposit"
      );

      // Check nullifiers haven't been seen before, this check will also fail if duplicate nullifiers are found in the same transaction
      for (uint256 nullifierIter = 0; nullifierIter < transaction._nullifiers.length; nullifierIter++) {
        uint256 nullifier = transaction._nullifiers[nullifierIter];

        // Check if nullifier hasn't been seen
        require(!Commitments.nullifiers[nullifier], "RailgunLogic: Nullifier already seen");

        // Push to nullifiers
        Commitments.nullifiers[nullifier] = true;

        // Emit event
        emit Nullifier(nullifier);
      }

      // Verify proof
      require(
        Verifier.verifyProof(
          // Proof
          transaction._proof,
          // Shared
          transaction._adaptIDcontract,
          transaction._adaptIDparameters,
          transaction._depositAmount,
          transaction._withdrawAmount,
          transaction._tokenField,
          transaction._outputEthAddress,
          // Join
          transaction._treeNumber,
          transaction._merkleRoot,
          transaction._nullifiers,
          // Split
          transaction._commitmentsOut
        ),
        "RailgunLogic: Invalid SNARK proof"
      );

      // Retrieve ERC20 interface
      IERC20 token = IERC20(transaction._tokenField);

      // Deposit tokens if required
      // Fee is on top of deposit
      if (transaction._depositAmount > 0) {
        // Calculate fee
        uint256 feeAmount = transaction._depositAmount * depositFee / BASIS_POINTS;

        // Use OpenZeppelin safetransfer to revert on failure - https://github.com/ethereum/solidity/issues/4116
        // Transfer deposit
        token.safeTransferFrom(msg.sender, address(this), transaction._depositAmount);

        // Transfer fee
        token.safeTransferFrom(msg.sender, treasury, feeAmount);
      }

      // Withdraw tokens if required
      // Fee is subtracted from withdraw
      if (transaction._withdrawAmount > 0) {
        // Calculate fee
        uint256 feeAmount = transaction._withdrawAmount * withdrawFee / BASIS_POINTS;

        // Use OpenZeppelin safetransfer to revert on failure - https://github.com/ethereum/solidity/issues/4116
        // Transfer withdraw
        token.safeTransfer(transaction._outputEthAddress, transaction._withdrawAmount - feeAmount);

        // Transfer fee
        token.safeTransfer(treasury, feeAmount);
      }
    
      //add commitments to the struct
      for(uint256 commitmientsIter = 0; commitmientsIter < transaction._commitmentsOut.length; commitmientsIter++){
        // Throw if commitment hash is invalid
        require(
          transaction._commitmentsOut[commitmientsIter].hash < SNARK_SCALAR_FIELD,
          "Commitments: context.leafHash[] entries must be < SNARK_SCALAR_FIELD"
        );

        // Push hash to insertion array
        insertionLeaves[commitments] =  transaction._commitmentsOut[commitmientsIter].hash;

        // Push commitment to event array
        newCommitments[commitments] = Commitment(
          transaction._commitmentsOut[commitmientsIter].hash,
          transaction._commitmentsOut[commitmientsIter].ciphertext,
          transaction._commitmentsOut[commitmientsIter].senderPubKey
        );

        // Increment commitments count
        commitments++;
      }
    }

    // Create new tree if current tree can't contain entries
    if ((nextLeafIndex + commitments) > (2 ** TREE_DEPTH)) { Commitments.newTree(); }

    // Emit commitment state update
    emit CommitmentBatch(Commitments.treeNumber, Commitments.nextLeafIndex, newCommitments);

    // Push new commitments to merkle free
    Commitments.insertLeaves(insertionLeaves);
  }

  /**
   * @notice Deposits requested amount and token, creates a commitment hash from supplied values and adds to tree
   * @dev This is for DeFi integrations where the resulting number of tokens to be added
   * can't be known in advance (eg. AMM trade where transaction ordering could cause token amounts to change)
   * @param _transactions - list of commitments to generate
   */

  function generateDeposit(GeneratedCommitment[] calldata _transactions) external payable {
    // Check treasury fee is paid
    require(msg.value >= transferFee, "RailgunLogic: Fee not paid");

    // Transfer to treasury
    (bool sent,) = treasury.call{value: msg.value}("");
    require(sent, "Failed to send Ether");

    // Insertion array
    uint256[] memory insertionLeaves = new uint256[](_transactions.length);

    for (uint256 transactionIter = 0; transactionIter < _transactions.length; transactionIter++) {
      GeneratedCommitment calldata transaction = _transactions[transactionIter];

      // Check deposit amount is not 0
      require(transaction.amount > 0, "RailgunLogic: Cannot deposit 0 tokens");

      // Check token is on the whitelist
      // address(0) is wildcard (disables whitelist)
      require(
        TokenWhitelist.tokenWhitelist[transaction.token] ||
        TokenWhitelist.tokenWhitelist[address(0)],
        "RailgunLogic: Token isn't whitelisted for deposit"
      );

      // Check deposit amount isn't greater than max deposit amount
      require(transaction.amount < MAX_DEPOSIT_WITHDRAW, "RailgunLogic: depositAmount too high");

      // Check _random is in snark scalar field
      require(transaction.random < SNARK_SCALAR_FIELD, "RailgunLogic: random out of range");

      // Check pubkey points are in snark scalar field
      require(transaction.pubkey[0] < SNARK_SCALAR_FIELD, "RailgunLogic: pubkey[0] out of range");
      require(transaction.pubkey[1] < SNARK_SCALAR_FIELD, "RailgunLogic: pubkey[1] out of range");

      // Calculate fee
      // Fee is subtracted from deposit
      uint256 feeAmount = transaction.amount * depositFee / BASIS_POINTS;
      uint256 depositAmount = transaction.amount - feeAmount;

      // Calculate commitment hash
      uint256 hash = PoseidonT6.poseidon([
        transaction.pubkey[0],
        transaction.pubkey[1],
        transaction.random,
        transaction.amount,
        uint256(uint160(transaction.token))
      ]);

      // Add to insertion array
      insertionLeaves[transactionIter] = hash;

      // Get ERC20 interface
      IERC20 token = IERC20(transaction.token);

      // Use OpenZeppelin safetransfer to revert on failure - https://github.com/ethereum/solidity/issues/4116
      token.safeTransferFrom(msg.sender, address(this), depositAmount);

      // Transfer fee
      token.safeTransferFrom(msg.sender, treasury, feeAmount);
    }

    // Create new tree if current one can't contain existing tree
    // We insert all new commitment into a new tree to ensure they can be spent in the same transaction
    if ((nextLeafIndex + _transactions.length) >= (2 ** TREE_DEPTH)) { Commitments.newTree(); }

    // Emit GeneratedCommitmentAdded events (for wallets) for the commitments
    emit GeneratedCommitmentBatch(Commitments.treeNumber, Commitments.nextLeafIndex, _transactions);

    // Push new commitments to merkle free
    Commitments.insertLeaves(insertionLeaves);
  }
}
