// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

/**
 * @title OnlyAddress
 * @author Railgun Contributors
 * @notice Locks transaction to only be callable by one address
 */
contract OnlyAddress {
  /**
   * @notice Locks transaction to only be callable by one address
   * @param _lock - caller to lock transaction to
   * @dev this guards using tx.origin, which is probably NOT what you want.
   * Don't blindly use this unless you're absolutely sure you should be using tx.origin
   */
  function lock(address _lock) public view {
    // solhint-disable-next-line avoid-tx-origin
    require(tx.origin == _lock, "OnlyAddress: Caller isn't allowed to execute");
  }
}
