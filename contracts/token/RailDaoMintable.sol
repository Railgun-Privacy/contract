// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

// OpenZeppelin v4
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title RailTokenDAOMintable
 * @author Railgun Contributors
 * @notice ERC20 Railgun Governance Token
 */

contract RailTokenDAOMintable is Ownable, ERC20 {
  // Minting cap
  uint256 public cap;

  /**
   * @notice Mints initial token supply
   */

  constructor(
    address _initialHolder,
    uint256 _initialSupply,
    uint256 _cap,
    address _owner,
    string memory name,
    string memory symbol
  ) ERC20(name, symbol) {
    // Save cap
    cap = _cap;

    // Mint initial tokens
    _mint(_initialHolder, _initialSupply);

    // Transfer ownership
    Ownable.transferOwnership(_owner);
  }

  /**
   * @notice See ERC20._mint
   * @dev Overrides ERC20 mint to add hard cap check
   * @param _account - account to mint to
   * @param _amount - amount to mint
   */

  function _mint(address _account, uint256 _amount) internal override {
    require(
      ERC20.totalSupply() + _amount <= cap,
      "RailTokenDAOMintable: Can't mint more than hard cap"
    );
    super._mint(_account, _amount);
  }

  /**
   * @notice Mints new coins if governance contract requests
   * @dev ONLY MINTABLE IF GOVERNANCE PROCESS PASSES, CANNOT MINT MORE THAN HARD CAP (cap())
   * @param _account - account to mint to
   * @param _amount - amount to mint
   * @return success
   */

  function governanceMint(
    address _account,
    uint256 _amount
  ) external onlyOwner returns (bool success) {
    _mint(_account, _amount);
    return true;
  }
}
