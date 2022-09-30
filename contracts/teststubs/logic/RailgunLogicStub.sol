// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { Commitments } from "../../logic/Commitments.sol";
import { RailgunLogic } from "../../logic/RailgunLogic.sol";

contract RailgunLogicStub is Commitments, RailgunLogic {
  function forceNewTree() external {
    Commitments.newTree();
  }

  function doubleInit(
    address payable _treasury,
    uint120 _depositFee,
    uint120 _withdrawFee,
    uint256 _nftFee,
    address _owner
  ) external {
    RailgunLogic.initializeRailgunLogic(_treasury, _depositFee, _withdrawFee, _nftFee, _owner);
  }
}
