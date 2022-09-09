// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;
import { VerifyingKey, SnarkProof } from "../../logic/Globals.sol";

import { Snark } from "../../logic/Snark.sol";

contract SnarkStub {
  function verify(
    VerifyingKey memory _verifyingKey,
    SnarkProof calldata _proof,
    uint256[] memory _inputs
  ) public view returns (bool) {
    return Snark.verify(_verifyingKey, _proof, _inputs);
  }
}
