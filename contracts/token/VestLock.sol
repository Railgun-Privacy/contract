// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Staking } from "../governance/Staking.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from  "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title VestLock
 * @author Railgun Contributors
 * @notice Escrows vested tokens
 * @dev Designed to be used behing lightweight clones proxies
 */

contract VestLock is Initializable, OwnableUpgradeable {
  using SafeERC20 for IERC20;

  // Time to release tokens
  uint256 public releaseTime;

  // Lock functions until after releaseTime
  modifier locked() {
    require(block.timestamp > releaseTime, "VestLock: Vesting hasn't matured yet");
    _;
  }

  /**
   * @notice Initializes escrow contract
   * @dev Token must be railgun token, requires delegate function on token contract
   * @param _beneficiary - address to send tokens to at release time
   * @param _releaseTime - time to release tokens
   */

  function initialize(
    address _beneficiary,
    uint256 _releaseTime
  ) external initializer {
    // Init OwnableUpgradeable
    OwnableUpgradeable.__Ownable_init();

    // Set beneficiary as owner
    OwnableUpgradeable.transferOwnership(_beneficiary);

    // Set release time
    releaseTime = _releaseTime;
  }

  /**
   * @notice Delegates stake
   * @param _staking - staking contract address
   * @param _id - id of stake to claim
   * @param _delegatee - address to delegate to
   */
  function delegate(Staking _staking, uint256 _id, address _delegatee) public onlyOwner {
    _staking.delegate(_id, _delegatee);
  }

  /**
   * @notice Stakes tokens
   * @param _token - address of the rail token
   * @param _staking - staking contract address
   * @param _amount - amount to stake
   */
  function stake(IERC20 _token, Staking _staking, uint256 _amount) external onlyOwner {
    _token.safeApprove(address(_staking), _amount);
    uint256 stakeID = _staking.stake(_amount);
    _staking.delegate(stakeID, OwnableUpgradeable.owner());
  }

  /**
   * @notice Unlocks tokens
   * @param _staking - staking contract address
   * @param _id - id of stake to unstake
   */
  function unlock(Staking _staking, uint256 _id) external onlyOwner {
    _staking.unlock(_id);
  }

  /**
   * @notice Claims tokens
   * @param _staking - staking contract address
   * @param _id - id of stake to claim
   */
  function claim(Staking _staking, uint256 _id) external onlyOwner {
    _staking.claim(_id);
  }

  /**
   * @notice Transfers ETH to specified address
   * @param _to - Address to transfer ETH to
   * @param _amount - Amount of ETH to transfer
   */
  function transferETH(address payable _to, uint256 _amount) external locked onlyOwner {
    _to.transfer(_amount);
  }

  /**
   * @notice Transfers ETH to specified address
   * @param _token - ERC20 token address to transfer
   * @param _to - Address to transfer tokens to
   * @param _amount - Amount of tokens to transfer
   */
  function transferERC20(IERC20 _token, address _to, uint256 _amount) external locked onlyOwner {
    _token.safeTransfer(_to, _amount);
  }

  /**
   * @notice Recieve ETH
   */
  // solhint-disable-next-line no-empty-blocks
  fallback() external payable {}

  /**
   * @notice Receive ETH
   */
  // solhint-disable-next-line no-empty-blocks
  receive() external payable {}
}
