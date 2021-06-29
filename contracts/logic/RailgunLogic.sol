// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from  "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { VerifyingKey, SnarkProof, Commitment, SNARK_SCALAR_FIELD, CIRCUIT_OUTPUTS } from "./Globals.sol";

import { Verifier } from "./Verifier.sol";
import { Commitments } from "./Commitments.sol";
import { TokenWhitelist } from "./TokenWhitelist.sol";

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
  uint256 public fee; // Fee in wei

  // Treasury events
  event TreasuryChange(address treasury);
  event FeeChange(uint256 fee);

  /**
   * @notice Initialize Railgun contract
   * @dev OpenZeppelin initializer ensures this can only be called once
   * This function also calls initializers on inherited contracts
   * @param _tokenWhitelist - Initial token whitelist to use
   * @param _treasury - address to send usage fees to
   * @param _fee - fee per transaction (in wei)
   * @param _owner - governance contract
   */

  function initializeRailgunLogic(
    VerifyingKey calldata _vKeySmall,
    VerifyingKey calldata _vKeyLarge,
    address[] calldata _tokenWhitelist,
    address payable _treasury,
    uint256 _fee,
    address _owner
  ) external initializer {
    // Call initializers
    OwnableUpgradeable.__Ownable_init();
    Commitments.initializeCommitments();
    TokenWhitelist.initializeTokenWhitelist(_tokenWhitelist);
    Verifier.initializeVerifier(_vKeySmall, _vKeyLarge);

    // Set treasury and fee
    changeTreasury(_treasury);
    changeFee(_fee);

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
   * @param _fee - New fee (in wei)
   */

  function changeFee(uint256 _fee) public onlyOwner {
    if (fee != _fee) {
      // Change fee
      fee = _fee;

      // Emit fee change event
      emit FeeChange(_fee);
    }
  }

  /**
   * @notice Perform a transaction in the Railgun system
   * @dev This function will perform any combination of deposit, internal transfer
   * and withdraw actions.
   * @param _proof - snark proof
   * @param _adaptIDcontract - contract address to this proof to (ignored if set to 0)
   * @param _adaptIDparameters - hash of the contract parameters (only used to verify proof, this is verified by the
   * calling contract)
   * @param _depositAmount - deposit amount
   * @param _withdrawAmount - withdraw amount
   * @param _tokenField - token to use if deposit/withdraw is requested
   * @param _outputEthAddress - eth address to use if withdraw is requested
   * @param _treeNumber - merkle tree number
   * @param _merkleRoot - merkle root to verify against
   * @param _nullifiers - nullifiers of commitments
   * @param _commitmentsOut - output commitments
   */

  function transact(
    // Proof
    SnarkProof calldata _proof,
    // Shared
    address _adaptIDcontract,
    uint256 _adaptIDparameters,
    uint256 _depositAmount,
    uint256 _withdrawAmount,
    address _tokenField,
    address _outputEthAddress,
    // Join
    uint256 _treeNumber,
    uint256 _merkleRoot,
    uint256[] calldata _nullifiers,
    // Split
    Commitment[CIRCUIT_OUTPUTS] calldata _commitmentsOut
  ) external payable {
    // Check treasury fee is paid
    require(msg.value >= fee, "RailgunLogic: Fee not paid");

    // Transfer to treasury
    // If the treasury contract fails (eg. with revert()) the tx or consumes more than 2300 gas railgun transactions will fail
    // If this is ever the case, changeTreasury() will neeed to be called to change to a good contract
    treasury.transfer(msg.value);

    // If _adaptIDcontract is not zero check that it matches the caller
    require(_adaptIDcontract == address (0) || _adaptIDcontract == msg.sender, "AdaptID doesn't match caller contract");

    // Check merkle root is valid
    require(Commitments.rootHistory[_treeNumber][_merkleRoot], "RailgunLogic: Invalid Merkle Root");

    // Check depositAmount and withdrawAmount are below max allowed value
    require(_depositAmount < MAX_DEPOSIT_WITHDRAW, "RailgunLogic: depositAmount too high");
    require(_withdrawAmount < MAX_DEPOSIT_WITHDRAW, "RailgunLogic: withdrawAmount too high");

    // If deposit amount is not 0, token should be on whitelist
    require(
      _depositAmount == 0 ||
      TokenWhitelist.tokenWhitelist[_tokenField],
      "RailgunLogic: Token isn't whitelisted for deposit"
    );

    // Check nullifiers haven't been seen before, this check will also fail if duplicate nullifiers are found in the same transaction
    for (uint i = 0; i < _nullifiers.length; i++) {
      uint256 nullifier = _nullifiers[i];

      require(!Commitments.nullifiers[nullifier], "RailgunLogic: Nullifier already seen");

      // Push to seen nullifiers
      Commitments.nullifiers[nullifier] = true;
    }

    // Verify proof
    require(
      Verifier.verifyProof(
        // Proof
        _proof,
        // Shared
        _adaptIDcontract,
        _adaptIDparameters,
        _depositAmount,
        _withdrawAmount,
        _tokenField,
        _outputEthAddress,
        // Join
        _treeNumber,
        _merkleRoot,
        _nullifiers,
        // Split
        _commitmentsOut
      ),
      "RailgunLogic: Invalid SNARK proof"
    );

    // Add commitments to accumulator
    Commitments.addCommitments(_commitmentsOut);

    IERC20 token = IERC20(_tokenField);

    // Deposit tokens if required
    if (_depositAmount > 0) {
      // Use OpenZeppelin safetransfer to revert on failure - https://github.com/ethereum/solidity/issues/4116
      token.safeTransferFrom(msg.sender, address(this), _depositAmount);
    }

    // Withdraw tokens if required
    if (_withdrawAmount > 0) {
      // Use OpenZeppelin safetransfer to revert on failure - https://github.com/ethereum/solidity/issues/4116
      token.safeTransfer(_outputEthAddress, _withdrawAmount);
    }
  }

  /**
   * @notice Deposits requested amount and token, creates a commitment hash from supplied values and adds to tree
   * @dev This is for DeFi integrations where the resulting number of tokens to be added
   * can't be known in advance (eg. AMM trade where transaction ordering could cause toekn amounts to change)
   * @param _pubkey - pubkey of commitment
   * @param _random - randomness field of commitment
   * @param _amount - amount of commitment
   * @param _tokenField - token ID of commitment
   */

  function generateDeposit(
    uint256[2] calldata _pubkey,
    uint256 _random,
    uint256 _amount,
    address _tokenField
  ) external {
    // Check deposit amount is not 0
    require(_amount > 0, "RailgunLogic: Cannot deposit 0 tokens");

    // Check token is on the whitelist
    require(TokenWhitelist.tokenWhitelist[_tokenField], "RailgunLogic: Token isn't whitelisted for deposit");

    // Check deposit amount isn't greater than max deposit amount
    require(_amount < MAX_DEPOSIT_WITHDRAW, "RailgunLogic: depositAmount too high");

    // Check _random is in snark scalar field
    require(_random < SNARK_SCALAR_FIELD, "RailgunLogic: random out of range");

    // Check pubkey points are in snark scalar field
    require(_pubkey[0] < SNARK_SCALAR_FIELD, "RailgunLogic: pubkey[0] out of range");
    require(_pubkey[1] < SNARK_SCALAR_FIELD, "RailgunLogic: pubkey[1] out of range");

    // Generate and add commmitment
    Commitments.addGeneratedCommitment(_pubkey, _random, _amount, _tokenField);

    IERC20 token = IERC20(_tokenField);

    // Use OpenZeppelin safetransfer to revert on failure - https://github.com/ethereum/solidity/issues/4116
    token.safeTransferFrom(msg.sender, address(this), _amount);
  }
}
