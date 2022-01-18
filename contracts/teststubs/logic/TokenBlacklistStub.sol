// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

//OpenZeppelin v4
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { TokenBlacklist } from "../../logic/TokenBlacklist.sol";

contract TokenBlacklistStub is TokenBlacklist {
  function initializeTokenBlacklistStub(address[] calldata _value) external initializer {
    OwnableUpgradeable.__Ownable_init();
    TokenBlacklist.initializeTokenBlacklist(_value);
  }
}
