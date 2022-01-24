// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;
import { SnarkProof, VerifyingKey, Commitment, SNARK_SCALAR_FIELD, CIRCUIT_OUTPUTS } from "../../logic/Globals.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { Verifier } from "../../logic/Verifier.sol";

contract VerifierStub is Verifier {
  function initializeVerifierStub(VerifyingKey calldata _vKeySmall, VerifyingKey calldata _vKeyLarge) external initializer {
    OwnableUpgradeable.__Ownable_init();
    Verifier.initializeVerifier(_vKeySmall, _vKeyLarge);
  }

  function hashCipherTextStub(Commitment[CIRCUIT_OUTPUTS] calldata _commitmentsOut) pure external returns(uint256) {
    return Verifier.hashCipherText(_commitmentsOut);
  }
  
  function inputsHashPreStub(    
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
    Commitment[CIRCUIT_OUTPUTS] calldata _commitmentsOut) pure external returns(uint256) {
        
    uint256[2] memory adaptIDhashPreimage;
    adaptIDhashPreimage[0] = uint256(uint160(_adaptIDcontract));
    adaptIDhashPreimage[1] = _adaptIDparameters;
    uint256 adaptIDhash = uint256(sha256(abi.encodePacked(adaptIDhashPreimage)));

    uint256 cipherTextHash = hashCipherText(_commitmentsOut);

    uint256[] memory inputsHashPreimage = new uint256[](13);
    inputsHashPreimage[0] = adaptIDhash % SNARK_SCALAR_FIELD;
    inputsHashPreimage[1] = _depositAmount;
    inputsHashPreimage[2] = _withdrawAmount;
    inputsHashPreimage[3] = uint256(uint160(_tokenField));
    inputsHashPreimage[4] = uint256(uint160(_outputEthAddress));
    inputsHashPreimage[5] = _treeNumber;
    inputsHashPreimage[6] = _merkleRoot;
    inputsHashPreimage[9] = _commitmentsOut[0].hash;
    inputsHashPreimage[10] = _commitmentsOut[1].hash;
    inputsHashPreimage[11] = _commitmentsOut[2].hash;
    inputsHashPreimage[12] = cipherTextHash % SNARK_SCALAR_FIELD;

    return Verifier.inputsHashPre(inputsHashPreimage, _nullifiers);
  }
}
