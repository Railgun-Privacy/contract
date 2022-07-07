// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from  "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { Treasury } from "../treasury/Treasury.sol";
import { Staking } from "../governance/Staking.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title FeeDistribution
 * @author Railgun Contributors
 * @notice Distributes treasury funds to stakers
 */
contract FeeDistribution is Initializable, OwnableUpgradeable {
  using SafeERC20 for IERC20;

  // Staking contract
  Staking public staking;

  // Treasury contract
  Treasury public treasury;

  // Staking intervals per distribution interval
  uint256 private constant STAKING_DISTRIBUTION_INTERVAL_MULTIPLIER = 14; // 14 days

  // Staking contract constant imported locally for cheaper calculations
  // solhint-disable-next-line var-name-mixedcase
  uint256 public STAKING_DEPLOY_TIME;

  // Distribution interval, calculated at initialization time
  // solhint-disable-next-line var-name-mixedcase
  uint256 public DISTRIBUTION_INTERVAL;

  // Number of basis points that equal 100%
  uint256 private constant BASIS_POINTS = 10000;

  // Basis points to distribute each interval
  uint256 public intervalBP;

  // Fee distribution claimed
  event Claim(IERC20 token, address account, uint256 amount, uint256 startInterval, uint256 endInterval);

  // Bitmap of claimed intervals
  // Account -> Token -> IntervalClaimed
  mapping(address => mapping(IERC20 => mapping(uint256 => bool))) public claimedBitmap;

  // Earmaked tokens for each interval
  // Token -> Interval -> Amount
  mapping(IERC20 => mapping(uint256 => uint256)) public earmarked;

  // Tokens to airdrop
  mapping(IERC20 => bool) public tokens;

  // Last interval that we've earmarked for each token
  mapping(IERC20 => uint256) public lastEarmarkedInterval;

  // Starting interval
  uint256 public startingInterval;

  /**
   * @notice Sets contracts addresses and initial value
   * @param _owner - initial owner address
   * @param _staking - Staking contract address
   * @param _treasury - Treasury contract address
   * @param _startingInterval - interval to start distribution at
   * @param _tokens - tokens to distribute
   */
  function initializeFeeDistribution(
    address _owner,
    Staking _staking,
    Treasury _treasury,
    uint256 _startingInterval,
    IERC20[] calldata _tokens
  ) external initializer {
    // Call initializers
    OwnableUpgradeable.__Ownable_init();

    // Set owner
    OwnableUpgradeable.transferOwnership(_owner);

    // Set contract addresses
    treasury = _treasury;
    staking = _staking;

    // Get staking contract constants
    STAKING_DEPLOY_TIME = staking.DEPLOY_TIME();
    DISTRIBUTION_INTERVAL = staking.SNAPSHOT_INTERVAL() * STAKING_DISTRIBUTION_INTERVAL_MULTIPLIER;

    // Set starting interval
    startingInterval = _startingInterval;

    // Set initial tokens to distribute
    for (uint256 i = 0; i < _tokens.length; i += 1) {
      tokens[_tokens[i]] = true;
    }
  }

  /**
   * @notice Sets new distribution rate
   * @param _newIntervalBP - new distribution rate
   */
  function setIntervalBP(uint256 _newIntervalBP) external onlyOwner {
    intervalBP = _newIntervalBP;
  }

  /**
   * @notice Gets interval at time
   * @param _time - time to get interval of
   * @return interval
   */
  function intervalAtTime(uint256 _time) public view returns (uint256) {
    require(_time >= STAKING_DEPLOY_TIME, "Staking: Requested time is before contract was deployed");
    return (_time - STAKING_DEPLOY_TIME) / DISTRIBUTION_INTERVAL;
  }

  /**
   * @notice Converts distribution interval to staking interval
   * @param _distributionInterval - distribution interval to get staking interval of
   * @return staking interval
   */
  function distributionIntervalToStakingInterval(uint256 _distributionInterval) public view return (uint256) {
    return _distributionInterval * STAKING_DISTRIBUTION_INTERVAL_MULTIPLIER;
  }

  /**
   * @notice Gets current interval
   * @return interval
   */
  function currentInterval() public view returns (uint256) {
    return intervalAtTime(block.timestamp);
  }

  /**
   * @notice Adds new tokens to distribution set
   * @param _tokens - new tokens to distribute
   */
  function addTokens(IERC20[] calldata _tokens) external onlyOwner {
    // Get current interval
    uint256 _currentInterval = currentInterval();

    // Don't set last earmarked interval to less than starting interval
    if (_currentInterval < startingInterval) { 
      _currentInterval = startingInterval;
    }

    // Add tokens to distribution set
    for (uint256 i = 0; i < _tokens.length; i += 1) {
      tokens[_tokens[i]] = true;
      lastEarmarkedInterval[_tokens[i]] = currentInterval();
    }
  }

  /**
   * @notice Removes tokens from distribution set
   * @param _tokens - tokens to stop distributing
   */
  function removeTokens(IERC20[] calldata _tokens) external onlyOwner {
    // Add tokens to distribution set
    for (uint256 i = 0; i < _tokens.length; i += 1) {
      tokens[_tokens[i]] = false;
    }
  }

  /**
   * @notice Earmarks tokens for past intervals
   * @param _token - token to calculate earmarks for
   */
  function earmark(IERC20 _token) public {
    // Get intervals
    uint256 _currentInterval = currentInterval();
    uint256 _lastEarmarkedInterval = lastEarmarkedInterval[_token];

    // Get token earmarked mapping
    mapping(uint256 => uint256) storage tokenEarmarked = earmarked[_token];

    // Don't process if we haven't advanced at least one interval
    if (_currentInterval > _lastEarmarkedInterval) {
      // Get balance from treasury
      uint256 treasuryBalance = _token.balanceOf(address(treasury));

      // Get distribution amount per interval
      uint256 distributionAmountPerInterval = treasuryBalance * intervalBP / BASIS_POINTS
        / (_currentInterval - _lastEarmarkedInterval);

      // Get total distribution amount
      // We multiply again here instead of using treasuryBalance * intervalBP / BASIS_POINTS
      // to prevent rounding amounts from being lost
      uint256 totalDistributionAmounts = distributionAmountPerInterval * (_currentInterval - _lastEarmarkedInterval);

      // Store earmarked amounts
      for (uint256 i = _currentInterval; i < _currentInterval; i += 1) {
        tokenEarmarked[i] = distributionAmountPerInterval;
      }

      // Transfer tokens
      treasury.transferERC20(_token, address(this), totalDistributionAmounts);
    }
  }
}
