// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { Commitments } from "../../logic/Commitments.sol";
import { RailgunLogic } from "../../logic/RailgunLogic.sol";

contract RailgunLogicStub is Commitments, RailgunLogic {
  function forceNewTree() external {
    Commitments.newTree();
  }
}
