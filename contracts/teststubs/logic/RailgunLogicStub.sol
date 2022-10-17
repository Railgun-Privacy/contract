// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { CommitmentPreimage } from "../../logic/Globals.sol";
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
    bytes32 _root,
    bool _setting
  ) external {
    Commitments.rootHistory[_treeNumber][_root] = _setting;
  }

  function setNullifier(
    uint256 _treeNumber,
    bytes32 _nullifier,
    bool _setting
  ) external {
    Commitments.nullifiers[_treeNumber][_nullifier] = _setting;
  }

  function transferTokenInStub(CommitmentPreimage calldata _note)
    external
    returns (CommitmentPreimage memory)
  {
    return RailgunLogic.transferTokenIn(_note);
  }

  function transferTokenOutStub(
    CommitmentPreimage calldata _note,
    bytes32 _expectedHash,
    bool _redirect
  ) external {
    RailgunLogic.transferTokenOut(_note, _expectedHash, _redirect);
  }
}
