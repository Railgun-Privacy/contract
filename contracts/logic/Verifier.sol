// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from  "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { SnarkProof, VerifyingKey, Commitment } from "./Types.sol";

import { Snark } from "./Snark.sol";

/**
 * @title Verifier
 * @author Railgun Contributors
 * @notice Verifies 
 * @dev Functions in this contract statelessly verify proofs, nullifiers, adaptID, and
 * depositAmount/withdrawAmount max sizes should be checked in RailgunLogic.
 * Note, functions have been split up to prevent exceedign solidity stack size limit.
 */

contract Verifier is Initializable, OwnableUpgradeable {
  // Snark scalar field
  uint256 private constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

  // Verifying keys
  VerifyingKey private vKeySmall;
  VerifyingKey private vKeyLarge;

  // Verification key changed events
  event SmallVerificationKeyChange(VerifyingKey vkey);
  event LargeVerificationKeyChange(VerifyingKey vkey);

  /**
   * @notice Hashes inputs for small proof verification
   * @param _adaptIDcontract - contract address to this proof to (ignored if set to 0)
   * @param _adaptIDparameters - hash of the contract parameters (only used to verify proof, this is verified by the
   * calling contract)
   * @param _depositAmount - deposit amount
   * @param _withdrawAmount - withdraw amount
   * @param _outputTokenField - token ID to use if deposit/withdraw is requested
   * @param _outputEthAddress - eth address to use if withdraw is requested
   * @param _nullifiers - nullifiers of commitments
   * @param _merkleRoot - merkle root to verify against
   * @param _commitmentsOut - output commitments
   * @return hash
   */
  function hashSmallInputs(
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
  ) private pure returns (uint256) {
    // Hash adaptID into single parameter
    uint256[2] memory adaptIDhashPreimage;
    adaptIDhashPreimage[0] = uint256(uint160(_adaptIDcontract));
    adaptIDhashPreimage[1] = _adaptIDparameters;

    uint256 adaptIDhash = uint256(sha256(abi.encodePacked(adaptIDhashPreimage)));

    // Hash ciphertext into single parameter
    uint256[24] memory cipherTextHashPreimage;
    // Commitment 0
    cipherTextHashPreimage[0] = _commitmentsOut[0].senderPubKey[0];
    cipherTextHashPreimage[1] = _commitmentsOut[0].senderPubKey[1];
    cipherTextHashPreimage[2] = _commitmentsOut[0].ciphertext[0];
    cipherTextHashPreimage[3] = _commitmentsOut[0].ciphertext[1];
    cipherTextHashPreimage[4] = _commitmentsOut[0].ciphertext[2];
    cipherTextHashPreimage[5] = _commitmentsOut[0].ciphertext[3];
    cipherTextHashPreimage[6] = _commitmentsOut[0].ciphertext[4];
    cipherTextHashPreimage[7] = _commitmentsOut[0].ciphertext[5];
    // Commitment 1
    cipherTextHashPreimage[8] = _commitmentsOut[1].senderPubKey[0];
    cipherTextHashPreimage[9] = _commitmentsOut[1].senderPubKey[1];
    cipherTextHashPreimage[10] = _commitmentsOut[1].ciphertext[0];
    cipherTextHashPreimage[11] = _commitmentsOut[1].ciphertext[1];
    cipherTextHashPreimage[12] = _commitmentsOut[1].ciphertext[2];
    cipherTextHashPreimage[13] = _commitmentsOut[1].ciphertext[3];
    cipherTextHashPreimage[14] = _commitmentsOut[1].ciphertext[4];
    cipherTextHashPreimage[15] = _commitmentsOut[1].ciphertext[5];
    // Commitment 2
    cipherTextHashPreimage[16] = _commitmentsOut[2].senderPubKey[0];
    cipherTextHashPreimage[17] = _commitmentsOut[2].senderPubKey[1];
    cipherTextHashPreimage[18] = _commitmentsOut[2].ciphertext[0];
    cipherTextHashPreimage[19] = _commitmentsOut[2].ciphertext[1];
    cipherTextHashPreimage[20] = _commitmentsOut[2].ciphertext[2];
    cipherTextHashPreimage[21] = _commitmentsOut[2].ciphertext[3];
    cipherTextHashPreimage[22] = _commitmentsOut[2].ciphertext[4];
    cipherTextHashPreimage[23] = _commitmentsOut[2].ciphertext[5];

    uint256 cipherTextHash = uint256(sha256(abi.encodePacked(cipherTextHashPreimage)));

    uint256[12] memory inputsHashPreimage;
    inputsHashPreimage[0] = adaptIDhash % SNARK_SCALAR_FIELD;
    inputsHashPreimage[1] = _depositAmount;
    inputsHashPreimage[2] = _withdrawAmount;
    inputsHashPreimage[3] = uint256(uint160(_outputTokenField));
    inputsHashPreimage[4] = uint256(uint160(_outputEthAddress));
    inputsHashPreimage[5] = _merkleRoot;
    inputsHashPreimage[6] = _nullifiers[0];
    inputsHashPreimage[7] = _nullifiers[1];
    inputsHashPreimage[8] = _commitmentsOut[0].hash;
    inputsHashPreimage[9] = _commitmentsOut[1].hash;
    inputsHashPreimage[10] = _commitmentsOut[2].hash;
    inputsHashPreimage[11] = cipherTextHash % SNARK_SCALAR_FIELD;

    return uint256(sha256(abi.encodePacked(inputsHashPreimage)));
  }

  /**
   * @notice Verify proof from a small transaction
   * @dev This function won't check if the merkle root is stored in the contract,
   * the nullifiers haven't been seed before, or if the deposit or withdraw amounts aren't
   * larger than allowed. It only verifies the snark proof is valid and the ciphertext is bound to the
   * proof.
   * @param _proof - snark proof
   * @param _inputsHash - hash of inputs
   * @return valid
   */
  function verifySmallProof(
    SnarkProof memory _proof,
    uint256 _inputsHash
  ) private view returns (bool) {
    return Snark.verify(
      vKeySmall,
      _proof,
      _inputsHash
    );
  }

  /**
   * @notice Hashes inputs for large proof verification
   * @param _adaptIDcontract - contract address to this proof to (ignored if set to 0)
   * @param _adaptIDparameters - hash of the contract parameters (only used to verify proof, this is verified by the
   * calling contract)
   * @param _depositAmount - deposit amount
   * @param _withdrawAmount - withdraw amount
   * @param _outputTokenField - token ID to use if deposit/withdraw is requested
   * @param _outputEthAddress - eth address to use if withdraw is requested
   * @param _nullifiers - nullifiers of commitments
   * @param _merkleRoot - merkle root to verify against
   * @param _commitmentsOut - output commitments
   * @return hash
   */
  function hashLargeInputs(
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
  ) private pure returns (uint256) {
    // Hash adaptID into single parameter
    uint256[2] memory adaptIDhashPreimage;
    adaptIDhashPreimage[0] = uint256(uint160(_adaptIDcontract));
    adaptIDhashPreimage[1] = _adaptIDparameters;

    uint256 adaptIDhash = uint256(sha256(abi.encodePacked(adaptIDhashPreimage)));

    // Hash ciphertext into single parameter
    uint256[24] memory cipherTextHashPreimage;
    // Commitment 0
    cipherTextHashPreimage[0] = _commitmentsOut[0].senderPubKey[0];
    cipherTextHashPreimage[1] = _commitmentsOut[0].senderPubKey[1];
    cipherTextHashPreimage[2] = _commitmentsOut[0].ciphertext[0];
    cipherTextHashPreimage[3] = _commitmentsOut[0].ciphertext[1];
    cipherTextHashPreimage[4] = _commitmentsOut[0].ciphertext[2];
    cipherTextHashPreimage[5] = _commitmentsOut[0].ciphertext[3];
    cipherTextHashPreimage[6] = _commitmentsOut[0].ciphertext[4];
    cipherTextHashPreimage[7] = _commitmentsOut[0].ciphertext[5];
    // Commitment 1
    cipherTextHashPreimage[8] = _commitmentsOut[1].senderPubKey[0];
    cipherTextHashPreimage[9] = _commitmentsOut[1].senderPubKey[1];
    cipherTextHashPreimage[10] = _commitmentsOut[1].ciphertext[0];
    cipherTextHashPreimage[11] = _commitmentsOut[1].ciphertext[1];
    cipherTextHashPreimage[12] = _commitmentsOut[1].ciphertext[2];
    cipherTextHashPreimage[13] = _commitmentsOut[1].ciphertext[3];
    cipherTextHashPreimage[14] = _commitmentsOut[1].ciphertext[4];
    cipherTextHashPreimage[15] = _commitmentsOut[1].ciphertext[5];
    // Commitment 2
    cipherTextHashPreimage[16] = _commitmentsOut[2].senderPubKey[0];
    cipherTextHashPreimage[17] = _commitmentsOut[2].senderPubKey[1];
    cipherTextHashPreimage[18] = _commitmentsOut[2].ciphertext[0];
    cipherTextHashPreimage[19] = _commitmentsOut[2].ciphertext[1];
    cipherTextHashPreimage[20] = _commitmentsOut[2].ciphertext[2];
    cipherTextHashPreimage[21] = _commitmentsOut[2].ciphertext[3];
    cipherTextHashPreimage[22] = _commitmentsOut[2].ciphertext[4];
    cipherTextHashPreimage[23] = _commitmentsOut[2].ciphertext[5];

    uint256 cipherTextHash = uint256(sha256(abi.encodePacked(cipherTextHashPreimage)));

    // Hash all inputs into single parameter
    uint256[18] memory inputsHashPreimage;
    inputsHashPreimage[0] = adaptIDhash % SNARK_SCALAR_FIELD;
    inputsHashPreimage[1] = _depositAmount;
    inputsHashPreimage[2] = _withdrawAmount;
    inputsHashPreimage[3] = uint256(uint160(_outputTokenField));
    inputsHashPreimage[4] = uint256(uint160(_outputEthAddress));
    inputsHashPreimage[5] = _merkleRoot;
    inputsHashPreimage[6] = _nullifiers[0];
    inputsHashPreimage[7] = _nullifiers[1];
    inputsHashPreimage[8] = _nullifiers[2];
    inputsHashPreimage[9] = _nullifiers[3];
    inputsHashPreimage[10] = _nullifiers[4];
    inputsHashPreimage[11] = _nullifiers[5];
    inputsHashPreimage[12] = _nullifiers[6];
    inputsHashPreimage[13] = _nullifiers[7];
    inputsHashPreimage[14] = _nullifiers[8];
    inputsHashPreimage[15] = _nullifiers[9];
    inputsHashPreimage[16] = _commitmentsOut[0].hash;
    inputsHashPreimage[17] = cipherTextHash % SNARK_SCALAR_FIELD;

    return uint256(sha256(abi.encodePacked(inputsHashPreimage)));
  }

  /**
   * @notice Verify proof from a Large transaction
   * @dev This function won't check if the merkle root is stored in the contract,
   * the nullifiers haven't been seed before, or if the deposit or withdraw amounts aren't
   * larger than allowed. It only verifies the snark proof is valid and the ciphertext is bound to the
   * proof.
   * @param _proof - snark proof
   * @param _inputsHash - hash of inputs
   * @return valid
   */
  function verifyLargeProof(
    SnarkProof memory _proof,
    uint256 _inputsHash
  ) private view returns (bool) {
    return Snark.verify(
      vKeyLarge,
      _proof,
      _inputsHash
    );
  }

  /**
   * @notice Verify snark proof for either Small or Large
   * @dev This function won't check if the merkle root is stored in the contract,
   * the nullifiers haven't been seed before, or if the deposit or withdraw amounts aren't
   * larger than allowed. It only verifies the snark proof is valid and the ciphertext is bound to the
   * proof.
   * @param _proof - snark proof
   * @param _adaptIDcontract - contract address to this proof to (ignored if set to 0)
   * @param _adaptIDparameters - hash of the contract parameters (only used to verify proof, this is verified by the
   * calling contract)
   * @param _depositAmount - deposit amount
   * @param _withdrawAmount - withdraw amount
   * @param _outputTokenField - token ID to use if deposit/withdraw is requested
   * @param _outputEthAddress - eth address to use if withdraw is requested
   * @param _nullifiers - nullifiers of commitments
   * @param _merkleRoot - merkle root to verify against
   * @param _commitmentsOut - output commitments
   * @return valid
   */

  function verifyProof(
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
  ) public view returns (bool) {
    if (_nullifiers.length == 2) {
      // Hash all inputs into single parameter
      uint256 inputsHash = hashSmallInputs(
        _adaptIDcontract,
        _adaptIDparameters,
        _depositAmount,
        _withdrawAmount,
        _outputTokenField,
        _outputEthAddress,
        _nullifiers,
        _merkleRoot,
        _commitmentsOut
      );

      // Verify proof
      return verifySmallProof(_proof, inputsHash % SNARK_SCALAR_FIELD);
    } else if (_nullifiers.length == 10) {
      // Hash all inputs into single parameter
      uint256 inputsHash = hashLargeInputs(
        _adaptIDcontract,
        _adaptIDparameters,
        _depositAmount,
        _withdrawAmount,
        _outputTokenField,
        _outputEthAddress,
        _nullifiers,
        _merkleRoot,
        _commitmentsOut
      );

      // Verify proof
      return verifyLargeProof(_proof, inputsHash % SNARK_SCALAR_FIELD);
    } else {
      return false;
    }
  }

  /**
   * @notice Sets initial values for verification key
   * @dev OpenZeppelin initializer ensures this can only be called once
   * @param _vKeySmall - Initial vkey value for small circuit
   * @param _vKeyLarge - Initial vkey value for large circuit
   */

  function initializeVerifier(VerifyingKey calldata _vKeySmall, VerifyingKey calldata _vKeyLarge) internal initializer {
    // Set verification key
    setVKeySmall(_vKeySmall);
    setVKeyLarge(_vKeyLarge);
  }

  /**
   * @notice Changes snark verification key for small transaction circuit
   * @param _vKey - verification key to change to
   * @return success
   */

  function setVKeySmall(VerifyingKey calldata _vKey) public onlyOwner returns (bool success) {
    // Copy everything manually as solidity can't copy structs to storage
    // Alpha
    vKeySmall.alpha1.x = _vKey.alpha1.x;
    vKeySmall.alpha1.y = _vKey.alpha1.y;
    // Beta
    vKeySmall.beta2.x[0] = _vKey.beta2.x[0];
    vKeySmall.beta2.x[1] = _vKey.beta2.x[1];
    vKeySmall.beta2.y[0] = _vKey.beta2.y[0];
    vKeySmall.beta2.y[1] = _vKey.beta2.y[1];
    // Gamma
    vKeySmall.gamma2.x[0] = _vKey.gamma2.x[0];
    vKeySmall.gamma2.x[1] = _vKey.gamma2.x[1];
    vKeySmall.gamma2.y[0] = _vKey.gamma2.y[0];
    vKeySmall.gamma2.y[1] = _vKey.gamma2.y[1];
    // Delta
    vKeySmall.delta2.x[0] = _vKey.delta2.x[0];
    vKeySmall.delta2.x[1] = _vKey.delta2.x[1];
    vKeySmall.delta2.y[0] = _vKey.delta2.y[0];
    vKeySmall.delta2.y[1] = _vKey.delta2.y[1];
    // IC
    vKeySmall.ic[0].x = _vKey.ic[0].x;
    vKeySmall.ic[0].y = _vKey.ic[0].y;
    vKeySmall.ic[1].x = _vKey.ic[1].x;
    vKeySmall.ic[1].y = _vKey.ic[1].y;

    // Emit change event
    emit SmallVerificationKeyChange(_vKey);

    return true;
  }

  /**
   * @notice Changes snark verification key for large transaction circuit
   * @param _vKey - verification key to change to
   * @return success
   */

  function setVKeyLarge(VerifyingKey calldata _vKey) public onlyOwner returns (bool success) {
    // Copy everything manually as solidity can't copy structs to storage
    // Alpha
    vKeyLarge.alpha1.x = _vKey.alpha1.x;
    vKeyLarge.alpha1.y = _vKey.alpha1.y;
    // Beta
    vKeyLarge.beta2.x[0] = _vKey.beta2.x[0];
    vKeyLarge.beta2.x[1] = _vKey.beta2.x[1];
    vKeyLarge.beta2.y[0] = _vKey.beta2.y[0];
    vKeyLarge.beta2.y[1] = _vKey.beta2.y[1];
    // Gamma
    vKeyLarge.gamma2.x[0] = _vKey.gamma2.x[0];
    vKeyLarge.gamma2.x[1] = _vKey.gamma2.x[1];
    vKeyLarge.gamma2.y[0] = _vKey.gamma2.y[0];
    vKeyLarge.gamma2.y[1] = _vKey.gamma2.y[1];
    // Delta
    vKeyLarge.delta2.x[0] = _vKey.delta2.x[0];
    vKeyLarge.delta2.x[1] = _vKey.delta2.x[1];
    vKeyLarge.delta2.y[0] = _vKey.delta2.y[0];
    vKeyLarge.delta2.y[1] = _vKey.delta2.y[1];
    // IC
    vKeyLarge.ic[0].x = _vKey.ic[0].x;
    vKeyLarge.ic[0].y = _vKey.ic[0].y;
    vKeyLarge.ic[1].x = _vKey.ic[1].x;
    vKeyLarge.ic[1].y = _vKey.ic[1].y;

    // Emit change event
    emit LargeVerificationKeyChange(_vKey);

    return true;
  }

  uint256[50] private __gap;
}
