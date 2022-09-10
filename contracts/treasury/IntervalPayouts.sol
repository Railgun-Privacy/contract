// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

// OpenZeppelin v4
import { Treasury } from "../treasury/Treasury.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IntervalPayouts
 * @author Railgun Contributors
 * @notice Pays out a specified amount from the treasury at set intervals
 */
contract IntervalPayouts {
  // Treasury contract
  Treasury public immutable treasury;

  // Beneficiary
  address payable public immutable beneficiary;

  // ETH/ERC20 token
  address public immutable token;

  // Amount to pay out per interval
  uint256 public immutable amount;

  // Interval length
  uint256 public immutable intervalLength;

  // Total number of payouts
  uint256 public immutable totalPayouts;

  // Starting time
  uint256 public immutable startTime;

  // Next interval to be processed
  uint256 public nextInterval = 0;

  /**
   * @notice Sets distribution parameters
   * @param _treasury - treasury to distribute from
   * @param _beneficiary - address to send tokens to
   * @param _token - token to pay out
   * @param _amount - amount to pay out per interval
   * @param _intervalLength - interval length
   * @param _totalPayouts - total number of payouts
   * @param _startTime - time to start first payout
   */
  constructor(
    Treasury _treasury,
    address payable _beneficiary,
    address _token,
    uint256 _amount,
    uint256 _intervalLength,
    uint256 _totalPayouts,
    uint256 _startTime
  ) {
    treasury = _treasury;
    beneficiary = _beneficiary;
    token = _token;
    amount = _amount;
    intervalLength = _intervalLength;
    totalPayouts = _totalPayouts;
    startTime = _startTime;
  }

  /**
   * @notice Check if payout is ready
   * @return payout ready
   */
  function ready() public view returns (bool) {
    // No more payouts after last payout is done
    if (nextInterval >= totalPayouts) {
      return false;
    }

    // Return true if timestamp is greater than the payout time for the next payout interval
    return block.timestamp > startTime + nextInterval * intervalLength;
  }

  /**
   * @notice Transfer payout
   */
  function payout() external {
    require(ready(), "IntervalPayouts: Payout not ready");

    // Increment next interval counter
    nextInterval += 1;

    if (token == address(0)) {
      // If token is address 0, treat as ETH
      treasury.transferETH(beneficiary, amount);
    } else {
      // Pay out ERC20
      treasury.transferERC20(IERC20(token), beneficiary, amount);
    }
  }
}
