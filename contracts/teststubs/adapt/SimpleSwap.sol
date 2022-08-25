// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SimpleSwap {
  uint256 private constant BASIS_POINTS = 10000; // Number of basis points that equal 100%

  function swap(
    IERC20 _from,
    IERC20 _to,
    uint256 _amount,
    uint256 _rateBP
  ) external {
    _from.transferFrom(msg.sender, address(this), _amount);
    _to.transfer(msg.sender, (_amount * _rateBP) / BASIS_POINTS);
  }
}
