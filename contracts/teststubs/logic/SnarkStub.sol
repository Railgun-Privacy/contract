// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;
import { VerifyingKey, SnarkProof } from "../../logic/Globals.sol";

import { Snark, G1Point } from "../../logic/Snark.sol";

contract SnarkStub {
  function negate(G1Point memory p) external pure returns (G1Point memory) {
    return Snark.negate(p);
  }

  function verify(
    VerifyingKey memory _verifyingKey,
    SnarkProof calldata _proof,
    uint256[] memory _inputs
  ) external view returns (bool) {
    return Snark.verify(_verifyingKey, _proof, _inputs);
  }
}
