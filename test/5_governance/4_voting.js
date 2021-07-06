/* global describe it beforeEach ethers */
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = require('chai');

const proposalDocument = 'QmSnuWmxptJZdLJpKRarxBMS2Ju2oANVrgbr2xWbie9b2D';

// Contract deployments
let testERC20;
let staking;
let delegator;
let voting;
let target;

// Contract parameters
let sponsorWindow;
let votingStartOffset;
let votingYesEndOffset;
let votingNoEndOffset;
let executionStartOffset;
let executionEndOffset;
let quorum;
let proposalSponsorThreshold;

describe('Governance/Voting', () => {
  beforeEach(async () => {
    // Get build artifacts
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const Staking = await ethers.getContractFactory('StakingStub');
    const Voting = await ethers.getContractFactory('Voting');
    const Delegator = await ethers.getContractFactory('Delegator');
    const Target = await ethers.getContractFactory('GovernanceTargetAlphaStub');

    // Deploy contracts
    testERC20 = await TestERC20.deploy();
    staking = await Staking.deploy(testERC20.address);
    delegator = await Delegator.deploy((await ethers.getSigners())[0].address);
    voting = await Voting.deploy(staking.address, delegator.address);
    target = await Target.deploy();

    // Transfer ownership of delegator to voting
    delegator.transferOwnership(voting.address);

    // Approve entire balance for staking
    await testERC20.approve(
      staking.address,
      await testERC20.balanceOf(
        (await ethers.getSigners())[0].address,
      ),
    );

    // Stake entire balance
    await staking.stake(
      await testERC20.balanceOf(
        (await ethers.getSigners())[0].address,
      ),
    );

    // Get snapshot interval
    const snapshotInterval = Number((await staking.SNAPSHOT_INTERVAL()).toString());

    // Increast time to first interval
    await ethers.provider.send('evm_increaseTime', [snapshotInterval]);
    await ethers.provider.send('evm_mine');

    // Ensure snapshot is taken
    await staking.snapshotStub((await ethers.getSigners())[0].address);

    // Get contract parameters
    sponsorWindow = await voting.SPONSOR_WINDOW();
    votingStartOffset = await voting.VOTING_START_OFFSET();
    votingYesEndOffset = await voting.VOTING_YAY_END_OFFSET();
    votingNoEndOffset = await voting.VOTING_NAY_END_OFFSET();
    executionStartOffset = await voting.EXECUTION_START_OFFSET();
    executionEndOffset = await voting.EXECUTION_END_OFFSET();
    quorum = await voting.QUORUM();
    proposalSponsorThreshold = await voting.PROPOSAL_SPONSOR_THRESHOLD();
  });

  it('Should go through vote lifecycle correctly', async () => {
    // Create proposal
    await voting.createProposal(proposalDocument, [
      {
        callContract: target.address,
        selector: target.interface.getSighash('a()'),
        data: [],
      },
    ]);

    // Get proposal document
    let proposal = await voting.proposals(0n);

    // Check it has been correctly created
    expect(proposal.proposer).to.equal((await ethers.getSigners())[0].address);
    expect(proposal.proposalDocument).to.equal(proposalDocument);
    expect(proposal.publishTime).to.not.equal(0n);
    expect(proposal.voteCallTime).to.equal(0n);
    expect(proposal.sponsorInterval).to.equal(1n);

    // Trying to cast vote should fail
    await expect(voting.vote(0n, 100n, true, 0n)).to.eventually.be.rejectedWith(
      'Voting: Vote hasn\'t been called for this proposal',
    );

    // Trying to execute should fail
    await expect(voting.executeProposal(0n)).to.eventually.be.rejectedWith(
      'Voting: Vote hasn\'t been called for this proposal',
    );

    // Sponsor proposal
    await voting.sponsorProposal(0n, proposalSponsorThreshold, 0n);

    // Trying to cast vote should fail
    await expect(voting.vote(0n, 100n, true, 0n)).to.eventually.be.rejectedWith(
      'Voting: Vote hasn\'t been called for this proposal',
    );

    // Trying to execute should fail
    await expect(voting.executeProposal(0n)).to.eventually.be.rejectedWith(
      'Voting: Vote hasn\'t been called for this proposal',
    );

    // Unsponsor vote
    await voting.unsponsorProposal(0n, proposalSponsorThreshold);

    // Unsponsoring more than sponsored should fail
    await expect(voting.unsponsorProposal(0n, proposalSponsorThreshold))
      .to.eventually.be.rejectedWith('Voting: Amount greater than sponsored');

    // Trying to call vote should fail
    await expect(voting.callVote(0n)).to.eventually.be.rejectedWith(
      'Voting: Sponsor threshold not met',
    );

    // Sponsor proposal
    await voting.sponsorProposal(0n, proposalSponsorThreshold, 0n);

    // Send to vote
    await voting.callVote(0n);

    // Get proposal document
    proposal = await voting.proposals(0n);

    // Check it has been correctly updated
    expect(proposal.voteCallTime).to.not.equal(0n);
    expect(proposal.votingInterval).to.equal(1n);

    // Trying to call vote should fail
    await expect(voting.callVote(0n)).to.eventually.be.rejectedWith(
      'Voting: Proposal already gone to vote',
    );

    // Trying to execute should fail
    await expect(voting.executeProposal(0n)).to.eventually.be.rejectedWith(
      'Voting: Quorum hasn\'t been reached',
    );

    // Trying to vote should fail
    await expect(voting.vote(0n, quorum, true, 0n)).to.eventually.be.rejectedWith(
      'Voting: Voting window hasn\'t opened',
    );

    // Increase time to voting window
    await ethers.provider.send('evm_increaseTime', [Number(votingStartOffset.toString())]);
    await ethers.provider.send('evm_mine');

    // Cast vote
    await voting.vote(0n, quorum, true, 0n);
    await voting.vote(0n, quorum, true, 0n);
    await voting.vote(0n, quorum, true, 0n);
    await voting.vote(0n, quorum, true, 0n);

    // Trying to execute should fail
    await expect(voting.executeProposal(0n)).to.eventually.be.rejectedWith(
      'Voting: Execution window hasn\'t opened',
    );

    // Increase time to yes window end
    await ethers.provider.send('evm_increaseTime', [
      Number(votingYesEndOffset.toString())
      - Number(votingStartOffset.toString()),
    ]);
    await ethers.provider.send('evm_mine');

    // Vote yes should fail
    await expect(voting.vote(0n, quorum, true, 0n)).to.eventually.be.rejectedWith(
      'Voting: Affirmative voting window has closed',
    );

    // Cast a no vote
    await voting.vote(0n, quorum, false, 0n);

    // Increase time to no window end
    await ethers.provider.send('evm_increaseTime', [
      Number(votingNoEndOffset.toString())
      - Number(votingYesEndOffset.toString()),
    ]);
    await ethers.provider.send('evm_mine');

    // Vote no should fail
    await expect(voting.vote(0n, quorum, false, 0n)).to.eventually.be.rejectedWith(
      'Voting: Negative voting window has closed',
    );

    // Take snapshot
    const snapshot = await ethers.provider.send('evm_snapshot');

    // Increase time to execution window start
    await ethers.provider.send('evm_increaseTime', [
      Number(executionStartOffset.toString())
      - Number(votingNoEndOffset.toString()),
    ]);
    await ethers.provider.send('evm_mine');

    // Execute vote
    await voting.executeProposal(0n);

    // Execute should fail
    await expect(voting.executeProposal(0n)).to.eventually.be.rejectedWith(
      'Voting: Proposal has already been executed',
    );

    // Restore snapshot
    await ethers.provider.send('evm_revert', [snapshot]);

    // Increase time to execution window end
    await ethers.provider.send('evm_increaseTime', [
      Number(executionEndOffset.toString())
      - Number(votingNoEndOffset.toString()),
    ]);
    await ethers.provider.send('evm_mine');

    // Execute should fail
    await expect(voting.executeProposal(0n)).to.eventually.be.rejectedWith(
      'Voting: Execution window has closed',
    );
  });

  it('Should not be able to sponsor after the sponsor window', async () => {
    // Create proposal
    await voting.createProposal(proposalDocument, [
      {
        callContract: target.address,
        selector: target.interface.getSighash('a()'),
        data: [],
      },
    ]);

    // Increase time to sponsor window end
    await ethers.provider.send('evm_increaseTime', [
      Number(sponsorWindow.toString()),
    ]);
    await ethers.provider.send('evm_mine');

    // Sponsor should fail
    await expect(
      voting.sponsorProposal(0n, proposalSponsorThreshold, 0n),
    ).to.eventually.be.rejectedWith(
      'Voting: Sponsoring window passed',
    );
  });

  it('Should not not execute failed proposal', async () => {
    // Create proposal
    await voting.createProposal(proposalDocument, [
      {
        callContract: target.address,
        selector: target.interface.getSighash('a()'),
        data: [],
      },
    ]);

    // Sponsor proposal
    await voting.sponsorProposal(0n, proposalSponsorThreshold, 0n);

    // Send to vote
    await voting.callVote(0n);

    // Increase time to voting window
    await ethers.provider.send('evm_increaseTime', [Number(votingStartOffset.toString())]);
    await ethers.provider.send('evm_mine');

    // Cast vote
    await voting.vote(0n, quorum, false, 0n);

    // Increase time to execution window start
    await ethers.provider.send('evm_increaseTime', [
      Number(executionStartOffset.toString())
      - Number(votingStartOffset.toString()),
    ]);
    await ethers.provider.send('evm_mine');

    // Execute should fail
    await expect(voting.executeProposal(0n)).to.eventually.be.rejectedWith(
      'Voting: Proposal hasn\'t passed vote',
    );
  });
});
