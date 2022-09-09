// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

// OpenZeppelin v4
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title RailTokenDAOMintable
 * @author Railgun Contributors
 * @notice ERC20 Railgun Governance Token
 */

contract RailTokenFixedSupply is ERC20 {
  /**
   * @notice Mints initial token supply
   */

  constructor(
    address _initialHolder,
    uint256 _initialSupply,
    string memory name,
    string memory symbol
  ) ERC20(name, symbol) {
    // Mint initial tokens
    _mint(_initialHolder, _initialSupply);
  }
}
