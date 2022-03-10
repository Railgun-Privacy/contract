// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { OwnableUpgradeable } from  "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { SnarkProof, TokenData, Transaction, VerifyingKey, SNARK_SCALAR_FIELD } from "./Globals.sol";

import { Snark } from "./Snark.sol";

/**
 * @title Verifier
 * @author Railgun Contributors
 * @notice Verifies snark proof
 * @dev Functions in this contract statelessly verify proofs, nullifiers and adaptID should be checked in RailgunLogic.
 */

contract Verifier is OwnableUpgradeable {
  // NOTE: The order of instantiation MUST stay the same across upgrades
  // add new variables to the bottom of the list and decrement __gap
  // See https://docs.openzeppelin.com/learn/upgrading-smart-contracts#upgrading

  // Nullifiers => Commitments => Verification Key
  mapping(uint256 => mapping(uint256 => VerifyingKey)) public verificationKeys;

  /**
   * @notice Sets verification key
   * @param _nullifiers - number of nullifiers this verification key is for
   * @param _commitments - number of commitmets out this verification key is for
   * @param _verifyingKey - verifyingKey to set
   */
  function setVerificationKey(
    uint256 _nullifiers,
    uint256 _commitments,
    VerifyingKey calldata _verifyingKey
  ) public onlyOwner {
    // TODO: Check if struct copying is an issue here
    verificationKeys[_nullifiers][_commitments] = _verifyingKey;
  }

  /**
   * @notice Calculate token field from tokendata
   * @param _tokenData - tokendata to calculate tokenfield from
   * @return tokenField
   */
  function calculateTokenField(TokenData calldata _tokenData) public pure returns (uint256) {
    if (_tokenData.tokenType == 0) {
      // Type is ERC20, just return token address
      return uint256(uint160(_tokenData.tokenAddress));
    }

    if (_tokenData.tokenType == 1 || _tokenData.tokenType == 2) {
      // Type is ERC721 or ERC1155, return hash of token address and token sub ID
      return uint256(keccak256(abi.encodePacked(
        _tokenData.tokenAddress,
        _tokenData.tokenSubID
      ))) % SNARK_SCALAR_FIELD;
    }

    revert("Verifier: Token Field Unknown");
  }

  /**
   * @notice Calculates hash of transaction inputs for snark verification
   * @param _transaction - transaction to hash
   * @return transaction hash
   */
  function hashInputs(Transaction calldata _transaction) public pure returns (uint256) {
    return uint256(sha256(
      abi.encodePacked(
        _transaction.merkleRoot,
        _transaction.nullifiers,
        _transaction.commitments,
        uint256(keccak256(abi.encode(
          _transaction.boundParams,
          _transaction.commitmentCiphertext
        ))) % SNARK_SCALAR_FIELD
      )
    )) % SNARK_SCALAR_FIELD;
  }

  /**
   * @notice Verifies an inputs hash against a verification key
   * @param _proof - proof to verify
   * @param _inputsHash - input hash to verify
   * @param _verifyingKey - verifying key to verify with
   * @return proof validity
   */
  function verifyProof(
    SnarkProof calldata _proof,
    uint256 _inputsHash,
    VerifyingKey memory _verifyingKey
  ) public view returns (bool) {
    return Snark.verify(
      _verifyingKey,
      _proof,
      _inputsHash
    );
  }

  /**
   * @notice Verifies a transaction
   * @param _transaction to verify
   * @return transaction validity
   */
  function verify(Transaction calldata _transaction) public view returns (bool) {
    // Ensure merkleRoot, nullifiers, and commitments are in range
    require(_transaction.merkleRoot < SNARK_SCALAR_FIELD, "Verifier: Merkle root out of range");

    // Fetch commitments length once for gas efficiency
    uint256 commitmentLength = _transaction.commitments.length;
    for (uint256 commitmientsIter = 0; commitmientsIter < commitmentLength; commitmientsIter++) {
      require(_transaction.commitments[commitmientsIter] < SNARK_SCALAR_FIELD, "Verifier: Commitment out of range");
    }

    // Fetch nullifiers length once for gas efficiency
    uint256 nullifierLength = _transaction.commitments.length;
    for (uint256 nullifierIter = 0; nullifierIter < nullifierLength; nullifierIter++) {
      require(_transaction.nullifiers[nullifierIter] < SNARK_SCALAR_FIELD, "Verifier: Nullifier out of range");
    }

    // Hash inputs
    uint256 inputsHash = hashInputs(_transaction);

    // Retrieve verification key
    VerifyingKey memory verifyingKey = verificationKeys
      [_transaction.nullifiers.length]
      [_transaction.commitments.length];
    
    // Verify snark proof
    bool validity = verifyProof(
      _transaction.proof,
      inputsHash,
      verifyingKey
    );

    // Always return true in gas estimation transaction
    // This is so relayer fees can be calculated without needing to compute a proof
    if (tx.origin == address(0)) {
      return true;
    } else {
      return validity;
    }
  }

  uint256[49] private __gap;
}
