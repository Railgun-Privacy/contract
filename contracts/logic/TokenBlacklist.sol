// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title Token Blacklist
 * @author Railgun Contributors
 * @notice Blacklist of tokens that are incompatible with the protocol
 * @dev Tokens on this blacklist can't be deposited to railgun.
 * Tokens on this blacklist will still be transferrable
 * internally (as internal transactions have a shielded token ID) and
 * withdrawable (to prevent user funds from being locked)
 * THIS WILL ALWAYS BE A NON-EXHAUSTIVE LIST, DO NOT RELY ON IT BLOCKING ALL
 * INCOMPATIBLE TOKENS
 */
contract TokenBlacklist is Initializable, OwnableUpgradeable {
  // Events for offchain building of blacklist index
  event TokenListing(uint256 indexed token);
  event TokenDelisting(uint256 indexed token);

  // NOTE: The order of instantiation MUST stay the same across upgrades
  // add new variables to the bottom of the list and decrement the __gap
  // variable at the end of this file
  // See https://docs.openzeppelin.com/learn/upgrading-smart-contracts#upgrading
  mapping(uint256 => bool) public tokenBlacklist;

  /**
   * @notice Adds initial set of tokens to blacklist.
   * @dev OpenZeppelin initializer ensures this can only be called once
   * @param _tokens - List of tokens to add to blacklist
   */
  function initializeTokenBlacklist(uint256[] calldata _tokens) internal initializer {
    // Push initial token blacklist to map
    addToBlacklist(_tokens);
  }

  /**
   * @notice Adds tokens to blacklist, only callable by owner (governance contract)
   * @dev This function will ignore tokens that are already in the blacklist
   * no events will be emitted in this case
   * @param _tokens - List of tokens to add to blacklist
   */
  function addToBlacklist(uint256[] calldata _tokens) public onlyOwner {
    // Loop through token array
    for (uint256 i = 0; i < _tokens.length; i++) {
      // Don't do anything if the token is already blacklisted
      if (!tokenBlacklist[_tokens[i]]) {
          // Set token address in blacklist map to true
        tokenBlacklist[_tokens[i]] = true;

        // Emit event for building index of blacklisted tokens offchain
        emit TokenListing(_tokens[i]);
      }
    }
  }

  /**
   * @notice Removes token from blacklist, only callable by owner (governance contract)
   * @dev This function will ignore tokens that aren't in the blacklist
   * no events will be emitted in this case
   * @param _tokens - List of tokens to remove from blacklist
   */
  function removeFromBlacklist(uint256[] calldata _tokens) external onlyOwner {
    // Loop through token array
    for (uint256 i = 0; i < _tokens.length; i++) {
      // Don't do anything if the token isn't blacklisted
      if (tokenBlacklist[_tokens[i]]) {
        // Set token address in blacklisted map to false (default value)
        delete tokenBlacklist[_tokens[i]];

        // Emit event for building index of blacklisted tokens offchain
        emit TokenDelisting(_tokens[i]);
      }
    }
  }

  uint256[49] private __gap;
}
