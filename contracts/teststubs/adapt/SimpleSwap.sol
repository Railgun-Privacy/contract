// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

// OpenZeppelin v4
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract SimpleSwap {
  using SafeERC20 for IERC20;

  uint256 private constant BASIS_POINTS = 10000; // Number of basis points that equal 100%

  function swap(IERC20 _from, IERC20 _to, uint256 _amount, uint256 _rateBP) external {
    _from.safeTransferFrom(msg.sender, address(this), _amount);
    _to.safeTransfer(msg.sender, (_amount * _rateBP) / BASIS_POINTS);
  }
}
