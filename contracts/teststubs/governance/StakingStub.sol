// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { Staking } from "../../governance/Staking.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract StakingStub is Staking {
  // solhint-disable-next-line no-empty-blocks
  constructor(IERC20 _stakingToken) Staking(_stakingToken) {}

  function snapshotStub(address _account) public {
    Staking.snapshot(_account);
  }
}
