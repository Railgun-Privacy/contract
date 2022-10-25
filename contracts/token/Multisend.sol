// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

// OpenZeppelin v4
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Multisend
 * @author Railgun Contributors
 * @notice Sends tokens as batch
 */
contract Multisend {
  using SafeERC20 for IERC20;

  struct Transfer {
    address to;
    uint256 amount;
  }

  /**
   * @notice Sends tokens as batch
   * @param token - token to send
   * @param transfers - array of addresses/amounts
   */

  function multisend(IERC20 token, Transfer[] calldata transfers) public {
    for (uint256 i = 0; i < transfers.length; i += 1) {
      token.safeTransferFrom(msg.sender, transfers[i].to, transfers[i].amount);
    }
  }
}
