// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { Ownable } from  "@openzeppelin/contracts/access/Ownable.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { VestLock } from "./VestLock.sol";

/**
 * @title Distributor
 * @author Railgun Contributors
 * @notice Distributes vesting funds into vesting locks
 */
contract Distributor is Ownable {
  address public vestLockImplementation;

  mapping(address => VestLock) public vestLocks;

  /**
   * @notice Sets initial admin
   * @param _admin - address to accept vesting calls from
   * @param _vestLockImplementation - implementation address for vestlock contract
   */

  constructor(address _admin, address _vestLockImplementation) {
    // Set initial admin
    Ownable.transferOwnership(_admin);

    // Set vestlock implementation
    vestLockImplementation = _vestLockImplementation;
  }

  /**
   * @notice Creates a clone of vestlock contract
   * @param _beneficiary - beneficiary
   * @param _releaseTime - release time
   */

  function createVestLock(address _beneficiary, uint256 _releaseTime) external onlyOwner {
    // Deploy clone
    VestLock vestLock = VestLock(
      payable(Clones.clone(vestLockImplementation))
    );

    // Store vest lock
    vestLocks[_beneficiary] = vestLock;

    // Initialize clone
    vestLock.initialize(_beneficiary, _releaseTime);
  }
}
