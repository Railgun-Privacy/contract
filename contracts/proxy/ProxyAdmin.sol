// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

// OpenZeppelin v4
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { PausableUpgradableProxy } from "./Proxy.sol";

/**
 * @title ProxyAdmin
 * @author Railgun Contributors
 * @notice Admin interface for PausableUpgradableProxy
 * @dev All non-proxied calls must go through this contract
 */
contract ProxyAdmin is Ownable {
  /**
   * @notice Sets initial admin
   */
  constructor(address _admin) {
    Ownable.transferOwnership(_admin);
  }

  /**
   * @notice Transfers ownership of proxy to new address
   * @param _proxy - proxy to administrate
   * @param _newOwner - Address to transfer ownership to
   */
  function transferProxyOwnership(
    PausableUpgradableProxy _proxy,
    address _newOwner
  ) external onlyOwner {
    _proxy.transferOwnership(_newOwner);
  }

  /**
   * @notice Upgrades implementation
   * @param _proxy - Proxy to upgrade
   * @param _newImplementation - Address of the new implementation
   */
  function upgrade(PausableUpgradableProxy _proxy, address _newImplementation) external onlyOwner {
    _proxy.upgrade(_newImplementation);
  }

  /**
   * @notice Pauses contract
   * @param _proxy - Proxy to pause
   */
  function pause(PausableUpgradableProxy _proxy) external onlyOwner {
    _proxy.pause();
  }

  /**
   * @notice Unpauses contract
   * @param _proxy - Proxy to pause
   */
  function unpause(PausableUpgradableProxy _proxy) external onlyOwner {
    _proxy.unpause();
  }
}
