// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

// OpenZeppelin v4
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { IInbox } from "@arbitrum/nitro-contracts/src/bridge/IInbox.sol";

import { ArbitrumExecutor } from "./Executor.sol";

/**
 * @title Sender
 * @author Railgun Contributors
 * @notice Sets tasks on Arbitrum sender to executable
 */
contract ArbitrumSender is Ownable {
  // solhint-disable-next-line var-name-mixedcase
  address public immutable EXECUTOR_L2; // Sender contract on L2
  // solhint-disable-next-line var-name-mixedcase
  IInbox public immutable ARBITRUM_INBOX; // Arbitrum Inbox

  event RetryableTicketCreated(uint256 id);

  /**
   * @notice Sets contract addresses
   * @param _admin - delegator contract
   * @param _executorL2 - sender contract on L1
   * @param _arbitrumInbox - arbitrum inbox address
   */
  constructor(address _admin, address _executorL2, IInbox _arbitrumInbox) {
    Ownable.transferOwnership(_admin);
    EXECUTOR_L2 = _executorL2;
    ARBITRUM_INBOX = _arbitrumInbox;
  }

  /**
   * @notice Sends ready task instruction to arbitrum executor
   * @param _task - task ID to ready
   */
  function readyTask(uint256 _task) external onlyOwner {
    // Create retryable ticket on arbitrum to set execution for governance task to true
    uint256 ticketID = ARBITRUM_INBOX.createRetryableTicket(
      EXECUTOR_L2,
      0,
      0,
      msg.sender,
      msg.sender,
      0,
      0,
      abi.encodeWithSelector(ArbitrumExecutor.readyTask.selector, _task)
    );

    // Emit event with ticket ID so EOAs can retry on Arbitrum if need be
    emit RetryableTicketCreated(ticketID);
  }
}