// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

//OpenZeppelin v4
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { TokenBlocklist } from "../../logic/TokenBlocklist.sol";

contract TokenBlocklistStub is TokenBlocklist {
  constructor() {
    initializeTokenBlocklistStub();
  }

  function initializeTokenBlocklistStub() internal initializer {
    OwnableUpgradeable.__Ownable_init();
  }
}
