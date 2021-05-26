// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from  "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { VerifyingKey, SnarkProof, Commitment } from "./Types.sol";

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
   * @return success
   */

  function changeTreasury(address payable _treasury) public onlyOwner returns (bool success) {
    // Change treasury
    treasury = _treasury;

    // Emit treasury change event
    emit TreasuryChange(_treasury);

    return true;
  }

  /**
   * @notice Change fee rate for future transactions
   * @param _fee - New fee (in wei)
   * @return success
   */

  function changeFee(uint256 _fee) public onlyOwner returns (bool success) {
    // Change fee
    fee = _fee;

    // Emit fee change event
    emit FeeChange(_fee);

    return true;
  }

  /**
   * @notice Perform a transaction in the Railgun system
   * @dev This function will perform any combination of deposit, internal transfer
   * and withdraw actions.
   * @param _adaptIDcontract - contract address to this proof to (ignored if set to 0)
   * @param _adaptIDparameters - hash of the contract parameters (only used to verify proof, this is verified by the
   * calling contract)
   * @param _proof - snark proof
   * @param _depositAmount - deposit amount
   * @param _withdrawAmount - withdraw amount
   * @param _outputTokenField - token ID to use if deposit/withdraw is requested
   * @param _outputEthAddress - eth address to use if withdraw is requested
   * @param _nullifiers - nullifiers of commitments
   * @param _merkleRoot - merkle root to verify against
   * @param _commitmentsOut - output commitments
   * @return success
   */

  function transact(
    // Proof
    SnarkProof calldata _proof,
    // Shared
    address _adaptIDcontract,
    uint256 _adaptIDparameters,
    uint256 _depositAmount,
    uint256 _withdrawAmount,
    address _outputTokenField,
    address _outputEthAddress,
    // Join
    uint256[] calldata _nullifiers,
    uint256 _merkleRoot,
    // Split
    Commitment[] calldata _commitmentsOut
  ) external payable returns (bool success) {
    // Check treasury fee is paid
    require(msg.value >= fee, "RailgunLogic: Fee not paid");

    // Transfer to treasury
    // If the treasury contract fails (eg. with revert()) the tx or consumes more than 2300 gas railgun transactions will fail
    // If this is ever the case, changeTreasury() will neeed to be called to change to a good contract
    treasury.transfer(msg.value);

    // If _adaptIDcontract is not zero check that it matches the caller
    if (_adaptIDcontract != address(0)) {
      require(_adaptIDcontract == msg.sender, "AdaptID doesn't match caller contract");
    }

    // Check merkle root is valid
    require(Commitments.rootHistory[_merkleRoot], "RailgunLogic: Invalid Merkle Root");

    // Check depositAmount and withdrawAmount are below max allowed value
    require(_depositAmount < 2**120, "RailgunLogic: depositAmount too high");
    require(_withdrawAmount < 2**120, "RailgunLogic: withdrawAmount too high");

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
        _outputTokenField,
        _outputEthAddress,
        // Join
        _nullifiers,
        _merkleRoot,
        // Split
        _commitmentsOut
      ),
      "RailgunLogic: Invalid SNARK proof"
    );

    Commitments.addCommitments(_commitmentsOut);

    // Transfer tokens in/out of contract as needed for deposit/withdraws
    IERC20 token = IERC20(_outputTokenField);

    if (_depositAmount > 0) {
      // Token should be whitelisted to deposit
      require(
        TokenWhitelist.tokenWhitelist[_outputTokenField],
        "RailgunLogic: Token isn't whitelisted for deposit"
      );

      require(
        token.transferFrom(msg.sender, address(this), _depositAmount),
        "RailgunLogic: Deposit token transfer failed"
      );
    }

    if (_withdrawAmount > 0) {
      require(
        token.transfer(_outputEthAddress, _withdrawAmount),
        "RailgunLogic: Withdraw token transfer failed"
      );
    }

    return true;
  }

  /**
   * @notice Deposits requested amount and token, creates a commitment hash from supplied values and adds to tree
   * @dev This is for DeFi integrations where the resulting number of tokens to be added
   * can't be known in advance (eg. AMM trade where transaction ordering could cause toekn amounts to change)
   * @param _pubkey - pubkey of commitment
   * @param _serial - serial of commitment
   * @param _amount - amount of commitment
   * @param _token - token ID of commitment
   */

  function generateDeposit(
    uint256[2] calldata _pubkey,
    uint256 _serial,
    uint256 _amount,
    address _token
  ) external returns (bool success) {
    // Check deposit amount is not 0
    require(_amount > 0, "RailgunLogic: Cannot deposit 0 tokens");

    // Transfer tokens
    IERC20 tokenContract = IERC20(_token);

    require(
      tokenContract.transferFrom(msg.sender, address(this), _amount),
      "RailgunLogic: Deposit token transfer failed"
    );

    // Generate and add commmitment
    Commitments.addGeneratedCommitment(_pubkey, _serial, _amount, _token);

    return true;
  }
}
