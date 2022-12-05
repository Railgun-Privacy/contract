// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

// OpenZeppelin v4
import { LibArbitrumL2 } from "@openzeppelin/contracts/crosschain/arbitrum/LibArbitrumL2.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { Delegator } from "../Delegator.sol";

/**
 * @title Executor
 * @author Railgun Contributors
 * @notice Stores instructions to execute after rollup sender confirms
 */
contract ArbitrumExecutor {
  address public immutable SENDER_L1; // Voting contract on L1
  Delegator public immutable DELEGATOR; // Delegator contract

  // Action structure
  struct Action {
    address callContract;
    bytes data;
    uint256 value;
  }

  // Task structure
  struct Task {
    bool canExecute; // Starts marked false, is marked true when signalled by L1 voting contract
    // marked false again when executed
    Action[] actions; // Calls to execute
  }

  // Task queue
  Task[] tasks;

  // Task events
  event TaskCreated(uint256 id);
  event TaskReady(uint256 id);
  event TaskExecuted(uint256 id);

  // Errors event
  error ExecutionFailed(uint256 index, bytes data);

  /**
   * @notice Sets contract addresses
   * @param _senderL1 - sender contract on L1
   * @param _delegator - delegator contract
   */
  constructor(address _senderL1, Delegator _delegator) {
    SENDER_L1 = _senderL1;
    DELEGATOR = _delegator;
  }

  /**
   * @notice Creates new task
   * @param _actions - list of calls to execute for this task
   */
  function createTask(Action[] calldata _actions) external {
    uint256 taskID = tasks.length;

    // Get new task
    Task storage task = tasks.push();

    // Set call list
    // Loop over actions and copy manually as solidity doesn't support copying struct arrays from calldata
    for (uint256 i = 0; i < _actions.length; i += 1) {
      task.actions.push(Action(_actions[i].callContract, _actions[i].data, _actions[i].value));
    }

    // Emit event
    emit TaskCreated(taskID);
  }

  /**
   * @notice Executes task
   * @param _task - task ID to execute
   */
  function readyTask(uint256 _task) external {
    // Check cross chain call
    require(
      LibArbitrumL2.isCrossChain(LibArbitrumL2.ARBSYS) &&
        LibArbitrumL2.crossChainSender(LibArbitrumL2.ARBSYS) == SENDER_L1,
      "ArbitrumExecutor: Caller is not L1 sender contract"
    );

    // Set task can execute
    tasks[_task].canExecute = true;

    // Emit event
    emit TaskReady(_task);
  }

  /**
   * @notice Executes task
   * @param _task - task ID to execute
   */
  function executeTask(uint256 _task) external {
    // Get task
    Task storage task = tasks[_task];

    // Check task can be executed
    require(task.canExecute, "ArbitrumExecutor: Task not marked as executable");

    // Mark task as executed
    task.canExecute = false;

    // Loop over actions and execute
    for (uint256 i = 0; i < task.actions.length; i += 1) {
      // Execute action
      (bool successful, bytes memory returnData) = DELEGATOR.callContract(
        task.actions[i].callContract,
        task.actions[i].data,
        task.actions[i].value
      );

      // If an action fails to execute, catch and bubble up reason with revert
      if (!successful) {
        revert ExecutionFailed(i, returnData);
      }
    }

    // Emit event
    emit TaskExecuted(_task);
  }
}

/**
 * @title Sender
 * @author Railgun Contributors
 * @notice Sends contract to
 */
contract ArbitrumSender is Ownable {
  address public immutable EXECUTOR_L2; // Sender contract on L2

  /**
   * @notice Sets contract addresses
   * @param _executorL2 - sender contract on L1
   * @param _admin - delegator contract
   */
  constructor(address _admin, address _executorL2) {
    Ownable.transferOwnership(_admin);
    EXECUTOR_L2 = _executorL2;
  }
}
