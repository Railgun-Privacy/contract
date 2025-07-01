// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;
pragma abicoder v2;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { OPStackExecutor } from "./Executor.sol";
import { IL2Sender } from "../IL2Sender.sol";

interface ICrossDomainMessenger {
  function sendMessage(
    address _target,
    bytes memory _message,
    uint32 _minGasLimit
  ) external payable;
}

/**
 * @title OPStackSender
 * @author Railgun Contributors
 * @notice Sets tasks on OP Stack executor to executable
 */
contract OPStackSender is Ownable, IL2Sender {
  ICrossDomainMessenger public immutable MESSENGER;
  address public executorL2;

  /**
   * @notice Sets contract addresses
   * @param _admin - admin address
   * @param _executorL2 - executor contract on L2
   * @param _messenger - L1 CrossDomainMessenger contract
   */
  constructor(address _admin, address _executorL2, ICrossDomainMessenger _messenger) {
    MESSENGER = _messenger;
    setExecutorL2(_executorL2);
    Ownable.transferOwnership(_admin);
  }

  /**
   * @notice Sends ready task instruction to OP Stack executor
   * @param _task - task ID to ready
   */
  function readyTask(uint256 _task) external onlyOwner returns (uint256) {
    bytes memory message = abi.encodeWithSelector(OPStackExecutor.readyTask.selector, _task);

    MESSENGER.sendMessage(
      executorL2,
      message,
      1000000 // minGasLimit - using same value as before
    );

    // Return 0 to maintain compatibility with Arbitrum interface
    return 0;
  }

  /**
   * @notice Sets L2 executor address
   * @param _executorL2 - new executor address
   */
  function setExecutorL2(address _executorL2) public onlyOwner {
    require(_executorL2 != address(0), "OPStackSender: Executor address is 0");
    executorL2 = _executorL2;
  }

  // Allow receiving ETH
  receive() external payable {}
}
