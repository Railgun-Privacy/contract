// SPDX-License-Identifier: UNLICENSED
pragma abicoder v2;
pragma solidity ^0.8.0;

//OpenZeppelin v4
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { TokenWhitelist } from "../../logic/TokenWhitelist.sol";

contract TokenWhitelistStub is TokenWhitelist {
  function initializeTokenWhitelistStub(address[] calldata _value) external initializer {
    OwnableUpgradeable.__Ownable_init();
    TokenWhitelist.initializeTokenWhitelist(_value);
  }
}
