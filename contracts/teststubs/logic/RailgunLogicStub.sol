// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { Commitments } from "../../logic/Commitments.sol";
import { RailgunLogic } from "../../logic/RailgunLogic.sol";

contract RailgunLogicStub is RailgunLogic {
  function forceNewTree() external {
    Commitments.newTree();
  }

  function doubleInit(
    address payable _treasury,
    uint120 _shieldFee,
    uint120 _unshieldFee,
    uint256 _nftFee,
    address _owner
  ) external {
    RailgunLogic.initializeRailgunLogic(_treasury, _shieldFee, _unshieldFee, _nftFee, _owner);
  }

  function setMerkleRoot(
    uint256 _treeNumber,
    bytes32 _root
  ) external {
    Commitments.rootHistory[_treeNumber][_root] = true;
  }
}
