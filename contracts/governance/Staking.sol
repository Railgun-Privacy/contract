// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

import "hardhat/console.sol";

// OpenZeppelin v4
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Voting
 * @author Railgun Contributors
 * @notice Governance contract for railgun, handles voting.
 * @dev Snapshots cannot be taken during interval 0
 * wait till interval 1 before utilising snapshots
 */
contract Staking {
  using SafeERC20 for IERC20;

  // Constants
  uint256 public constant STAKE_LOCKTIME = 30 days;
  uint256 public constant SNAPSHOT_INTERVAL = 1 days;

  // Staking token
  IERC20 public stakingToken;

  // Time of deployment
  // solhint-disable-next-line var-name-mixedcase
  uint256 public DEPLOY_TIME = block.timestamp;

  // New stake screated
  event Stake(address indexed account, uint256 stakeID, uint256 amount);

  // Stake unlocked (coins removed from voting pool, 30 day delay before claiming is allowed)
  event Unlock(address indexed account, uint256 stakeID);

  // Stake claimed
  event Claim(address indexed account, uint256 stakeID);

  // Delegate claimed
  event Delegate(address indexed owner, address indexed _from, address indexed to, uint256 stakeID, uint256 amount);

  // Total voting power
  uint256 public totalVotingPower = 0;

  // Total staked
  uint256 public totalStaked = 0;

  // Snapshots for globals
  struct GlobalsSnapshot {
    uint256 interval;
    uint256 totalVotingPower;
    uint256 totalStaked;
  }
  GlobalsSnapshot[] private globalsSnapshots;

  // Stake
  struct StakeStruct {
    address delegate; // Address stake voting power is delegated to
    uint256 amount; // Amount of tokens on this stake
    uint256 staketime; // Time this stake was created
    uint256 locktime; // Time this stake can be claimed (if 0, unlock hasn't been initiated)
    uint256 claimedTime; // Time this stake was claimed (if 0, stake hasn't been claimed)
  }

  // Stake mapping
  // address => stakeID => stake
  mapping(address => mapping(uint256 => StakeStruct)) public stakes;

  // StakeID height for each account
  mapping(address => uint256) public nextStake;

  // Voting power for each account
  mapping(address => uint256) public votingPower;

  // Snapshots for accounts
  struct AccountSnapshot {
    uint256 interval;
    uint256 votingPower;
  }
  mapping(address => AccountSnapshot[]) private accountSnapshots;

  /**
   * @notice Sets staking token
   * @param _stakingToken - time to get interval of
   */

  constructor(IERC20 _stakingToken) {
    stakingToken = _stakingToken;
  }

  /**
   * @notice Gets interval at time
   * @param _time - time to get interval of
   * @return interval
   */

  function intervalAtTime(uint256 _time) public view returns (uint256) {
    require(_time >= DEPLOY_TIME, "Staking: Requested time is before contract was deployed");
    return (_time - DEPLOY_TIME) / SNAPSHOT_INTERVAL;
  }

  /**
   * @notice Gets current interval
   * @return interval
   */

  function currentInterval() public view returns (uint256) {
    return intervalAtTime(block.timestamp);
  }

  /**
   * @notice Returns interval of latest global snapshot
   * @return Latest global snapshot interval
   */

  function latestGlobalsSnapshotInterval() public view returns (uint256) {
    if (globalsSnapshots.length > 0) {
      // If a snapshot exists return the interval it was taken
      return globalsSnapshots[globalsSnapshots.length - 1].interval;
    } else {
      // Else default to 0
      return 0;
    }
  }

  /**
   * @notice Returns interval of latest account snapshot
   * @param _account - account to get latest snapshot of
   * @return Latest account snapshot interval
   */

  function latestAccountSnapshotInterval(address _account) public view returns (uint256) {
    if (accountSnapshots[_account].length > 0) {
      // If a snapshot exists return the interval it was taken
      return accountSnapshots[_account][accountSnapshots[_account].length - 1].interval;
    } else {
      // Else default to 0
      return 0;
    }
  }

  /**
   * @notice Returns length of snapshot array
   * @param _account - account to get snapshot array length of
   * @return Snapshot array length
   */

  function accountSnapshotLength(address _account) external view returns (uint256) {
    return accountSnapshots[_account].length;
  }

  /**
   * @notice Returns length of snapshot array
   * @return Snapshot array length
   */

  function globalsSnapshotLength() external view returns (uint256) {
    return globalsSnapshots.length;
  }

  /**
   * @notice Returns global snapshot at index
   * @param _index - account to get latest snapshot of
   * @return Globals snapshot
   */

  function globalsSnapshot(uint256 _index) external view returns (GlobalsSnapshot memory) {
    require(_index < globalsSnapshots.length, "Staking: Index out of bounds");
    return globalsSnapshots[_index];
  }

  /**
   * @notice Returns account snapshot at index
   * @param _account - account to get snapshot of
   * @param _index - index to get snapshot at
   * @return Account snapshot
   */
  function accountSnapshot(address _account, uint256 _index) external view returns (AccountSnapshot memory) {
    require(_index < accountSnapshots[_account].length, "Staking: Index out of bounds");
    return accountSnapshots[_account][_index];
  }

  /**
   * @notice Checks if accoutn and globals snapshots need updating and updates
   * @param _account - Account to take snapshot for
   */
  function snapshot(address _account) internal {
    uint256 _currentInterval = currentInterval();

    // If latest global snapshot is less than current interval, push new snapshot
    if(latestGlobalsSnapshotInterval() < _currentInterval) {
      globalsSnapshots.push(GlobalsSnapshot(
        _currentInterval,
        totalVotingPower,
        totalStaked
      ));
    }

    // If latest account snapshot is less than current interval, push new snapshot
    // Skip if account is 0 address
    if(_account != address(0) && latestAccountSnapshotInterval(_account) < _currentInterval) {
      accountSnapshots[_account].push(AccountSnapshot(
        _currentInterval,
        votingPower[_account]
      ));
    }
  }

  /**
   * @notice Moves voting power in response to delegation or stake/unstake
   * @param _from - account to move voting power fom
   * @param _to - account to move voting power to
   * @param _amount - amount of voting power to move
   */
  function moveVotingPower(address _from, address _to, uint256 _amount) internal {
    // Don't process decrement operations if from address is 0
    if(_from != address(0)) {
      // Decrement voting power of from address
      votingPower[_from] -= _amount;

      // Decrement total voting power
      totalVotingPower -= _amount;
    }

    // Don't process increment operations if to address is 0
    if(_to != address(0)) {
      // Increment voting power
      votingPower[_to] += _amount;

      // Increment total voting power
      totalVotingPower += _amount;
    }
  }

  /**
   * @notice Updates vote delegation
   * @param _stakeID - stake to delegate
   * @param _to - address to delegate to
   */

  function delegate(uint256 _stakeID, address _to) public {
    require(
      stakes[msg.sender][_stakeID].staketime != 0,
      "Staking: Stake doesn't exist"
    );

    require(
      stakes[msg.sender][_stakeID].locktime == 0,
      "Staking: Stake unlocked"
    );

    // Check if snapshot needs to be taken
    snapshot(stakes[msg.sender][_stakeID].delegate); // From
    snapshot(_to); // To

    // Move voting power to delegatee
    moveVotingPower(
      stakes[msg.sender][_stakeID].delegate,
      _to,
      stakes[msg.sender][_stakeID].amount
    );

    // Emit event
    emit Delegate(msg.sender, stakes[msg.sender][_stakeID].delegate, _to, _stakeID, stakes[msg.sender][_stakeID].amount);

    // Update delegation
    stakes[msg.sender][_stakeID].delegate = _to;
  }

  /**
   * @notice Delegates voting power of stake back to self
   * @param _stakeID - stake to delegate back to self
   */

  function undelegate(uint256 _stakeID) external {
    delegate(_stakeID, msg.sender);
  }

  /**
   * @notice Gets global state at interval
   * @param _interval - interval to get state at
   * @return state
   */

  function globalsSnapshotAtSearch(uint256 _interval) internal view returns (GlobalsSnapshot memory) {
    require(_interval <= currentInterval(), "Staking: Interval out of bounds");

    // Index of element
    uint256 index;

    // High/low for binary serach to find index
    // https://en.wikipedia.org/wiki/Binary_search_algorithm
    uint256 low = 0;
    uint256 high = globalsSnapshots.length;

    while (low < high) {
      uint256 mid = Math.average(low, high);

      // Note that mid will always be strictly less than high (i.e. it will be a valid array index)
      // because Math.average rounds down (it does integer division with truncation).
      if (globalsSnapshots[mid].interval > _interval) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    // At this point `low` is the exclusive upper bound. Find the inclusive upper bounds and set to index
    if (low > 0 && globalsSnapshots[low - 1].interval == _interval) {
      index = low - 1;
    } else {
      index = low;
    }

    // If index is equal to snapshot array length, then no update was made after the requested
    // snapshot interval. This means the latest value is the right one.
    if (index == globalsSnapshots.length) {
      return GlobalsSnapshot(
        _interval,
        totalVotingPower,
        totalStaked
      );
    } else {
      return globalsSnapshots[index];
    }
  }

  /**
   * @notice Gets global state at interval
   * @param _interval - interval to get state at
   * @param _hint - off-chain computed index of interval
   * @return state
   */

  function globalsSnapshotAt(uint256 _interval, uint256 _hint) external view returns (GlobalsSnapshot memory) {
    require(_interval <= currentInterval(), "Staking: Interval out of bounds");

    // If no snapshot is taken return the current state
    if (globalsSnapshots.length== 0) {
      return GlobalsSnapshot(
        _interval,
        totalVotingPower,
        totalStaked
      );
    }

    // If hint is 0 (the first element in snapshot array)
    // The first element should be great than or equal to the interval requested
    if (
      _hint == 0
      && globalsSnapshots[_hint].interval >= _interval
    ) {
      return globalsSnapshots[_hint];
    }

    // If Hint is the last element in the snapshot array and interval is equal to what is requested, return
    if (
      _hint == globalsSnapshots.length - 1
      && globalsSnapshots[_hint].interval == _interval
    ) {
      return globalsSnapshots[_hint];
    }

    // If Hint in the last element in the snapshot array and interval is less than what is requested, generate snapshot
    if (
      _hint == globalsSnapshots.length - 1
      && globalsSnapshots[_hint].interval < _interval
    ) {
      return GlobalsSnapshot(
        _interval,
        totalVotingPower,
        totalStaked
      );
    }

    // If Hint is an element not at the ends of the array
    // First two lines files out cases where _hint is at either end of array
    // Hint interval should be greater than or equal to requested interval
    // Hint interval minus 1 should be less than requested interval
    if (
      _hint != 0
      && _hint != globalsSnapshots.length - 1
      && globalsSnapshots[_hint].interval >= _interval
      && globalsSnapshots[_hint - 1].interval < _interval
    ) {
      return globalsSnapshots[_hint];
    }

    // Fallback to binary search
    return globalsSnapshotAtSearch(_interval);
  }


  /**
   * @notice Gets account state at interval
   * @param _account - account to get state for
   * @param _interval - interval to get state at
   * @return state
   */
  function accountSnapshotAtSearch(address _account, uint256 _interval) internal view returns (AccountSnapshot memory) {
    require(_interval <= currentInterval(), "Staking: Interval out of bounds");

    // Index of element
    uint256 index;

    // High/low for binary serach to find index
    // https://en.wikipedia.org/wiki/Binary_search_algorithm
    uint256 low = 0;
    uint256 high = accountSnapshots[_account].length;

    while (low < high) {
      uint256 mid = Math.average(low, high);

      // Note that mid will always be strictly less than high (i.e. it will be a valid array index)
      // because Math.average rounds down (it does integer division with truncation).
      if (accountSnapshots[_account][mid].interval > _interval) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    // At this point `low` is the exclusive upper bound. Find the inclusive upper bounds and set to index
    if (low > 0 && accountSnapshots[_account][low - 1].interval == _interval) {
      index = low - 1;
    } else {
      index = low;
    }

    // If index is equal to snapshot array length, then no update was made after the requested
    // snapshot interval. This means the latest value is the right one.
    if (index == accountSnapshots[_account].length) {
      return AccountSnapshot(
        _interval,
        votingPower[_account]
      );
    } else {
      return accountSnapshots[_account][index];
    }
  }


  /**
   * @notice Gets account state at interval
   * @param _account - account to get state for
   * @param _interval - interval to get state at
   * @param _hint - off-chain computed index of interval
   * @return state
   */
  function accountSnapshotAt(address _account, uint256 _interval, uint256 _hint) external view returns (AccountSnapshot memory) {
    require(_interval <= currentInterval(), "Staking: Interval out of bounds");

    // If no snapshot is taken return the current state
    if (accountSnapshots[_account].length == 0) {
      return AccountSnapshot(
        _interval,
        votingPower[_account]
      );
    }

    // If hint is 0 (the first element in snapshot array)
    // The first element should be great than or equal to the interval requested
    if (
      _hint == 0
      && accountSnapshots[_account][_hint].interval >= _interval
    ) {
      return accountSnapshots[_account][_hint];
    }

    // If Hint is the last element in the snapshot array and interval is equal to what is requested, return
    if (
      _hint == accountSnapshots[_account].length - 1
      && accountSnapshots[_account][_hint].interval == _interval
    ) {
      return accountSnapshots[_account][_hint];
    }

    // If Hint in the last element in the snapshot array and interval is less than what is requested, generate snapshot
    if (
      _hint == accountSnapshots[_account].length - 1
      && accountSnapshots[_account][_hint].interval < _interval
    ) {
      return AccountSnapshot(
        _interval,
        votingPower[_account]
      );
    }

    // If Hint is an element not at the ends of the array
    // First two lines files out cases where _hint is at either end of array
    // Hint interval should be greater than or equal to requested interval
    // Hint interval minus 1 should be less than requested interval
    if (
      _hint > 0
      && _hint < accountSnapshots[_account].length - 1
      && accountSnapshots[_account][_hint].interval >= _interval
      && accountSnapshots[_account][_hint - 1].interval < _interval
    ) {
      return accountSnapshots[_account][_hint];
    }

    // Fallback to binary search
    return accountSnapshotAtSearch(_account, _interval);
  }

  /**
   * @notice Stake tokens
   * @dev This contract should be approve()'d for _amount
   * @param _amount - Amount to stake
   * @return stake ID
   */

  function stake(uint256 _amount) public returns (uint256) {
    // Check if amount is not 0
    require(_amount > 0, "Staking: Amount not set");

    // Check if snapshot needs to be taken
    snapshot(msg.sender);

    // Get stakeID
    uint256 stakeID = nextStake[msg.sender];

    // Increment nextStake;
    nextStake[msg.sender]++;

    // Set stake values
    stakes[msg.sender][stakeID].delegate = msg.sender;
    stakes[msg.sender][stakeID].amount = _amount;
    stakes[msg.sender][stakeID].staketime = block.timestamp;
    stakes[msg.sender][stakeID].locktime = 0;
    stakes[msg.sender][stakeID].claimedTime = 0;

    // Increment global staked
    totalStaked += _amount;

    // Add voting power
    moveVotingPower(
      address(0),
      msg.sender,
      _amount
    );

    // Transfer tokens
    stakingToken.safeTransferFrom(msg.sender, address(this), _amount);

    // Emit event
    emit Stake(msg.sender, stakeID, _amount);

    return stakeID;
  }

  /**
   * @notice Unlock stake tokens
   * @param _stakeID - Stake to unlock
   */

  function unlock(uint256 _stakeID) public {
    require(
      stakes[msg.sender][_stakeID].staketime != 0,
      "Staking: Stake doesn't exist"
    );

    require(
      stakes[msg.sender][_stakeID].locktime == 0,
      "Staking: Stake already unlocked"
    );

    // Check if snapshot needs to be taken
    snapshot(msg.sender);

    // Set stake locktime
    stakes[msg.sender][_stakeID].locktime = block.timestamp + STAKE_LOCKTIME;

    // Remove voting power
    moveVotingPower(
      stakes[msg.sender][_stakeID].delegate,
      address(0),
      stakes[msg.sender][_stakeID].amount
    );

    // Emit event
    emit Unlock(msg.sender, _stakeID);
  }

  /**
   * @notice Claim stake token
   * @param _stakeID - Stake to claim
   */

  function claim(uint256 _stakeID) public {
    require(
      stakes[msg.sender][_stakeID].locktime != 0
      && stakes[msg.sender][_stakeID].locktime < block.timestamp,
      "Staking: Stake not unlocked"
    );

    require(
      stakes[msg.sender][_stakeID].claimedTime == 0,
      "Staking: Stake already claimed"
    );

    // Check if snapshot needs to be taken
    snapshot(msg.sender);

    // Set stake claimed time
    stakes[msg.sender][_stakeID].claimedTime = block.timestamp;

    // Decrement global staked
    totalStaked -= stakes[msg.sender][_stakeID].amount;

    // Transfer tokens
    stakingToken.safeTransfer(
      msg.sender,
      stakes[msg.sender][_stakeID].amount
    );

    // Emit event
    emit Claim(msg.sender, _stakeID);
  }
}
