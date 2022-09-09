// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

//OpenZeppelin v4
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { TokenBlacklist } from "../../logic/TokenBlacklist.sol";

contract TokenBlacklistStub is TokenBlacklist {
  constructor() {
    initializeTokenBlacklistStub();
  }

  function initializeTokenBlacklistStub() internal initializer {
    OwnableUpgradeable.__Ownable_init();
  }
}
