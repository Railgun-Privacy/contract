// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { Delegator } from "../Delegator.sol";
import { IL2Executor } from "../IL2Executor.sol";

interface ICrossDomainMessenger {
  function xDomainMessageSender() external view returns (address);
  function sendMessage(
    address _target,
    bytes memory _message,
    uint32 _minGasLimit
  ) external payable;
}

/**
 * @title OPStackExecutor
 * @author Railgun Contributors
 * @notice Stores instructions to execute after L1 sender confirms
 */
contract OPStackExecutor is IL2Executor {
  // Addresses
  address public immutable SENDER_L1; // Voting contract on L1
  Delegator public immutable DELEGATOR; // Delegator contract
  ICrossDomainMessenger public immutable MESSENGER;

  uint256 public constant EXPIRY_TIME = 40 days;

  enum ExecutionState {
    Created,
    AwaitingExecution,
    Executed
  }

  // Task structure
  struct Task {
    uint256 creationTime; // Creation time of task
    ExecutionState state; // Execution state of task
    Action[] actions; // Calls to execute
  }

  // Task queue
  Task[] public tasks;

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
   * @param _messenger - L2 CrossDomainMessenger contract
   */
  constructor(address _senderL1, Delegator _delegator, ICrossDomainMessenger _messenger) {
    SENDER_L1 = _senderL1;
    DELEGATOR = _delegator;
    MESSENGER = _messenger;
  }

  /**
   * @notice Creates new task
   * @param _actions - list of calls to execute for this task
   */
  function createTask(Action[] calldata _actions) external returns (uint256) {
    uint256 taskID = tasks.length;

    Task storage task = tasks.push();
    task.creationTime = block.timestamp;
    task.state = ExecutionState.Created;

    for (uint256 i = 0; i < _actions.length; i += 1) {
      task.actions.push(Action(_actions[i].callContract, _actions[i].data, _actions[i].value));
    }

    emit TaskCreated(taskID);
    return taskID;
  }

  /**
   * @notice Gets actions for a task
   * @param _tasks - task to get actions for
   */
  function getActions(uint256 _tasks) external view returns (Action[] memory) {
    return tasks[_tasks].actions;
  }

  /**
   * @notice Executes task
   * @param _task - task ID to execute
   */
  function readyTask(uint256 _task) external {
    // Verify cross-domain call is from L1 sender
    require(
      msg.sender == address(MESSENGER) && MESSENGER.xDomainMessageSender() == SENDER_L1,
      "OPStackExecutor: Caller is not L1 sender contract"
    );

    Task storage task = tasks[_task];

    require(
      task.state == ExecutionState.Created,
      "OPStackExecutor: Task has already been executed"
    );

    task.state = ExecutionState.AwaitingExecution;
    emit TaskReady(_task);
  }

  /**
   * @notice Executes task
   * @param _task - task ID to execute
   */
  function executeTask(uint256 _task) external {
    Task storage task = tasks[_task];

    require(
      task.state == ExecutionState.AwaitingExecution,
      "OPStackExecutor: Task not marked as executable"
    );

    require(block.timestamp < task.creationTime + EXPIRY_TIME, "OPStackExecutor: Task has expired");

    task.state = ExecutionState.Executed;

    for (uint256 i = 0; i < task.actions.length; i += 1) {
      (bool successful, bytes memory returnData) = DELEGATOR.callContract(
        task.actions[i].callContract,
        task.actions[i].data,
        task.actions[i].value
      );

      if (!successful) {
        revert ExecutionFailed(i, returnData);
      }
    }

    emit TaskExecuted(_task);
  }
}
