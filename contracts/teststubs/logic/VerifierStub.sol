// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

//OpenZeppelin v4
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { Verifier } from "../../logic/Verifier.sol";

contract VerifierStub is Verifier {
  constructor() {
    initializeVerifierStub();
  }

  function initializeVerifierStub() internal initializer {
    OwnableUpgradeable.__Ownable_init();
  }
}
