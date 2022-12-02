// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { RailgunSmartWallet, Commitments } from "../../logic/RailgunSmartWallet.sol";

contract RailgunSmartWalletStub is RailgunSmartWallet {
  function newTreeStub() external {
    Commitments.newTree();
  }

  function setMerkleRoot(uint256 _treeNumber, bytes32 _root, bool _setting) external {
    Commitments.rootHistory[_treeNumber][_root] = _setting;
  }

  function setNullifier(uint256 _treeNumber, bytes32 _nullifier, bool _setting) external {
    Commitments.nullifiers[_treeNumber][_nullifier] = _setting;
  }
}
