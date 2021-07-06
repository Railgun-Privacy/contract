// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// OpenZeppelin v4
import { Staking } from "./Staking.sol";
import { Delegator } from "./Delegator.sol";

/**
 * @title Voting
 * @author Railgun Contributors
 * @notice Governance contract for railgun, handles voting.
 */
contract Voting {
  // Time offsets from publish time, offset times are relative to voteCallTime
  uint256 public constant SPONSOR_WINDOW = 30 days;
  uint256 public constant VOTING_START_OFFSET = 2 days; // Should be > interval size of staking snapshots
  uint256 public constant VOTING_YAY_END_OFFSET = 5 days;
  uint256 public constant VOTING_NAY_END_OFFSET = 6 days;
  uint256 public constant EXECUTION_START_OFFSET = 7 days;
  uint256 public constant EXECUTION_END_OFFSET = 14 days;

  // Threshold constants
  uint256 public constant QUORUM = 8000000 * 10 ** 18; // 8 million, 18 decimal places
  uint256 public constant PROPOSAL_SPONSOR_THRESHOLD = 2000000 * 10 ** 18; // 2 million, 18 decimal places

  // Proposal has been created
  event CreateProposal(uint256 indexed id, address indexed proposer);

  // Proposal has been sponsored
  event SponsorProposal(uint256 indexed id, address indexed sponsor, uint256 amount);

  // Proposal has been unsponsored
  event UnsponsorProposal(uint256 indexed id, address indexed sponsor, uint256 amount);

  // Proposal vote called
  event CallVote(uint256 indexed id);

  // Vote cast on proposal
  event CastVote(uint256 indexed id, address indexed voter, bool affirmative, uint256 votes);

  // Proposal executed
  event ExecuteProposal(uint256 indexed id);

  // Function call
  struct Call {
    address callContract;
    bytes4 selector;
    bytes data;
  }

  // Governance proposals
  struct Proposal {
    // Proposal Data
    address proposer;
    string proposalDocument; // IPFS hash
    Call[] actions;

    // Event timestamps
    uint256 publishTime;
    uint256 voteCallTime; // If vote call time is 0, proposal hasn't gone to vote

    // Sponsorship info
    uint256 sponsorship;
    mapping(address => uint256) sponsors;

    // Execution status
    bool executed;

    // Vote data
    // Amount of voting power used for accounts, used for fractional voting from contracts
    mapping(address => uint256) voted;
    uint256 yayVotes;
    uint256 nayVotes;

    // Staking snapshots
    uint256 sponsorInterval;
    uint256 votingInterval;
  }

  // Proposals id => proposal data
  mapping(uint256 => Proposal) public proposals;

  // Counter of proposal IDs
  uint256 public proposalCounter = 0;

  /* solhint-disable var-name-mixedcase */
  Staking public immutable STAKING_CONTRACT;
  Delegator public immutable DELEGATOR_CONTRACT;
  /* solhint-enable var-name-mixedcase */

  /**
   * @notice Sets governance token ID and delegator contract
   */
  constructor(Staking _stakingContract, Delegator _delegator) {
    STAKING_CONTRACT = _stakingContract;
    DELEGATOR_CONTRACT = _delegator;
  }

  /**
   * @notice Gets actions from proposal document
   * @dev Gets actions from proposal as nested arrays won't be returned on public getter
   * @param _id - Proposal to get actions of
   * @return actions
   */

  function getActions(uint256 _id) external view returns (Call[] memory) {
    return proposals[_id].actions;
  }

   /**
   * @notice Gets sponsor amount an account has given to a proposal
   * @dev Gets actions from proposal as mappings wont be returned on public getter
   * @param _id - Proposal to get sponsor amount of
   * @param _account - Account to get sponsor amount for
   * @return sponsor amount
   */

  function getSponsored(uint256 _id, address _account) external view returns (uint256) {
    return proposals[_id].sponsors[_account];
  }

  /**
   * @notice Creates governance proposal
   * @param _proposalDocument - IPFS multihash of proposal document
   * @param _actions - actions to take
   */

  function createProposal(string calldata _proposalDocument, Call[] calldata _actions) external {
    // Store proposer
    proposals[proposalCounter].proposer = msg.sender;

    // Store proposal document
    proposals[proposalCounter].proposalDocument = _proposalDocument;

    // Store published time
    proposals[proposalCounter].publishTime = block.timestamp;

    // Store sponsor voting snapshot interval
    proposals[proposalCounter].sponsorInterval = STAKING_CONTRACT.currentInterval();

    // Loop over actions and copy manually as solidity doesn't support copying structs
    for (uint256 i = 0; i < _actions.length; i++) {
      proposals[proposalCounter].actions.push(Call(
        _actions[i].callContract,
        _actions[i].selector,
        _actions[i].data
      ));
    }

    // Emit event
    emit CreateProposal(proposalCounter, msg.sender);

    // Increment proposal counter
    proposalCounter ++;
  }

  /**
   * @notice Sponsor proposal
   * @param _id - id of proposal to sponsor
   * @param _amount - amount to sponsor with
   * @param _hint - hint for snapshot search
   */

  function sponsorProposal(uint256 _id, uint256 _amount, uint256 _hint) external {
    // Check proposal hasn't already gone to vote
    require(proposals[_id].voteCallTime == 0, "Voting: Gone to vote");

    // Check proposal is still in sponsor window
    require(block.timestamp < proposals[_id].publishTime + SPONSOR_WINDOW, "Voting: Sponsoring window passed");

    // Get address sponsor voting power
    Staking.AccountSnapshot memory snapshot = STAKING_CONTRACT.accountSnapshotAt(
      msg.sender,
      proposals[_id].sponsorInterval,
      _hint
    );

    // Can't sponsor with more than voting power
    require(proposals[_id].sponsors[msg.sender] + _amount <= snapshot.votingPower, "Voting: Not enough voting power");

    // Update address sponsorship amount on proposal
    proposals[_id].sponsors[msg.sender] += _amount;

    // Update sponsor total
    proposals[_id].sponsorship += _amount;

    // Emit event
    emit SponsorProposal(_id, msg.sender, _amount);
  }

  /**
   * @notice Unsponsor proposal
   * @param _id - id of proposal to sponsor
   * @param _amount - amount to sponsor with
   */

  function unsponsorProposal(uint256 _id, uint256 _amount) external {
    // Check proposal hasn't already gone to vote
    require(proposals[_id].voteCallTime == 0, "Voting: Gone to vote");

    // Check proposal is still in sponsor window
    require(block.timestamp < proposals[_id].publishTime + SPONSOR_WINDOW, "Voting: Sponsoring window passed");

    // Can't unsponsor more than sponsored
    require(_amount <= proposals[_id].sponsors[msg.sender], "Voting: Amount greater than sponsored");

    // Update address sponsorship amount on proposal
    proposals[_id].sponsors[msg.sender] -= _amount;

    // Update sponsor total
    proposals[_id].sponsorship -= _amount;

    // Emit event
    emit UnsponsorProposal(_id, msg.sender, _amount);
  }

  /**
   * @notice Call vote
   * @param _id - id of proposal to call to vote
   */

  function callVote(uint256 _id) external {
    // Check proposal hasn't exceeded sponsor window
    require(block.timestamp < proposals[_id].publishTime + SPONSOR_WINDOW, "Voting: Sponsoring window passed");

    // Check proposal hasn't already gone to vote
    require(proposals[_id].voteCallTime == 0, "Voting: Proposal already gone to vote");

    // Proposal must meet sponsorship threshold
    require(proposals[_id].sponsorship >= PROPOSAL_SPONSOR_THRESHOLD, "Voting: Sponsor threshold not met");

    // Log vote time (also marks proposal as ready to vote)
    proposals[_id].voteCallTime = block.timestamp;

    // Log governance token snapshot interval
    // VOTING_START_OFFSET must be greater than snapshot interval of governance token for this to work correctly
    proposals[_id].votingInterval = STAKING_CONTRACT.currentInterval();

    // Emit event
    emit CallVote(_id);
  }

  /**
   * @notice Vote on proposal
   * @param _id - id of proposal to call to vote
   * @param _amount - amount of voting power to allocate
   * @param _affirmative - whether to vote yay (true) or nay (false) on this proposal
   * @param _hint - hint for snapshot search
   */

  function vote(uint256 _id, uint256 _amount, bool _affirmative, uint256 _hint) external {
    // Check vote has been called
    require(proposals[_id].voteCallTime > 0, "Voting: Vote hasn't been called for this proposal");

    // Check Voting window has opened
    require(block.timestamp > proposals[_id].voteCallTime + VOTING_START_OFFSET, "Voting: Voting window hasn't opened");

    // Check voting window hasn't closed (voting window length conditional on )
    if(_affirmative) {
      require(block.timestamp < proposals[_id].voteCallTime + VOTING_YAY_END_OFFSET, "Voting: Affirmative voting window has closed");
    } else {
      require(block.timestamp < proposals[_id].voteCallTime + VOTING_NAY_END_OFFSET, "Voting: Negative voting window has closed");
    }

    // Get address voting power
    Staking.AccountSnapshot memory snapshot = STAKING_CONTRACT.accountSnapshotAt(
      msg.sender,
      proposals[_id].votingInterval,
      _hint
    );

    // Check address isn't voting with more voting power than it has
    require(proposals[_id].voted[msg.sender] + _amount <= snapshot.votingPower, "Voting: Not enough voting power to cast this vote");

    // Update account voted amount
    proposals[_id].voted[msg.sender] += _amount;

    // Update voting totals
    if (_affirmative) {
      proposals[_id].yayVotes += _amount;
    } else {
      proposals[_id].nayVotes += _amount;
    }

    // Emit event
    emit CastVote(_id, msg.sender, _affirmative, _amount);
  }

  /**
   * @notice Execute proposal
   * @param _id - id of proposal to execute
   */

  function executeProposal(uint256 _id) external {
    // Check proposal has been called to vote
    require(proposals[_id].voteCallTime > 0, "Voting: Vote hasn't been called for this proposal");

    // Check quorum has been reached
    require(proposals[_id].yayVotes + proposals[_id].nayVotes >= QUORUM, "Voting: Quorum hasn't been reached");

    // Check vote passed
    require(proposals[_id].yayVotes > proposals[_id].nayVotes, "Voting: Proposal hasn't passed vote");

    // Check we're in execution window
    require(block.timestamp > proposals[_id].voteCallTime + EXECUTION_START_OFFSET, "Voting: Execution window hasn't opened");
    require(block.timestamp < proposals[_id].voteCallTime + EXECUTION_END_OFFSET, "Voting: Execution window has closed");

    // Check proposal hasn't been executed before
    require(!proposals[_id].executed, "Voting: Proposal has already been executed");

    // Mark proposal as executed
    proposals[_id].executed = true;

    // Loop over actions and execute
    for (uint256 i = 0; i < proposals[_id].actions.length; i++) {
      // Execute action
      (bool successful, bytes memory returnData) = DELEGATOR_CONTRACT.callContract(
        proposals[_id].actions[i].callContract,
        proposals[_id].actions[i].selector,
        proposals[_id].actions[i].data
      );

      // If an action fails to execute, catch and bubble up reason with revert
      if (!successful) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
          let returndata_size := mload(returnData)
          revert(add(32, returnData), returndata_size)
        }
      }
    }

    // Emit event
    emit ExecuteProposal(_id);
  }
}
