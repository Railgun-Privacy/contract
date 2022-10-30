// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { RelayAdapt } from "../../adapt/Relay.sol";

contract SimpleSwap {
  function attack() external {
    RelayAdapt relayAdapt = RelayAdapt(payable(msg.sender));
  }
}
