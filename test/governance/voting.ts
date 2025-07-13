import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, time, takeSnapshot } from '@nomicfoundation/hardhat-network-helpers';

const proposalDocument = 'QmSnuWmxptJZdLJpKRarxBMS2Ju2oANVrgbr2xWbie9b2D';

describe('Governance/Voting', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    // Get users
    const users = await ethers.getSigners();

    // Get build artifacts
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const Staking = await ethers.getContractFactory('StakingStub');
    const Voting = await ethers.getContractFactory('Voting');
    const Delegator = await ethers.getContractFactory('Delegator');
    const Target = await ethers.getContractFactory('GovernanceTargetAlphaStub');
    const Target2 = await ethers.getContractFactory('GovernanceStateChangeTargetStub');

    // Deploy contracts
    const testERC20 = await TestERC20.deploy();
    const staking = await Staking.deploy(testERC20.address);
    const delegator = await Delegator.deploy((await ethers.getSigners())[0].address);
    const voting = await Voting.deploy(staking.address, delegator.address);
    const target = await Target.deploy();
    const target2 = await Target2.deploy('hello');

    // Transfer ownership of delegator to voting
    await delegator.transferOwnership(voting.address);

    // Get mint balance
    const balance = 2n ** 128n - 1n;
    await testERC20.mint(users[0].address, balance);

    // Approve entire balance for staking
    await testERC20.approve(staking.address, 2n ** 256n - 1n);

    // Stake entire balance
    await staking.stake(balance);

    // Get contract parameters
    const snapshotInterval = Number(await staking.SNAPSHOT_INTERVAL());
    const sponsorWindow = Number(await voting.SPONSOR_WINDOW());
    const votingStartOffset = Number(await voting.VOTING_START_OFFSET());
    const votingYesEndOffset = Number(await voting.VOTING_YAY_END_OFFSET());
    const votingNoEndOffset = Number(await voting.VOTING_NAY_END_OFFSET());
    const executionStartOffset = Number(await voting.EXECUTION_START_OFFSET());
    const executionEndOffset = Number(await voting.EXECUTION_END_OFFSET());
    const quorum = (await voting.QUORUM()).toBigInt();
    const proposalSponsorThreshold = (await voting.PROPOSAL_SPONSOR_THRESHOLD()).toBigInt();
    const sponsorLockoutTime = (await voting.SPONSOR_LOCKOUT_TIME()).toBigInt();

    // Increase time to first interval
    await time.increase(snapshotInterval);

    // Ensure snapshot is taken
    await staking.snapshotStub((await ethers.getSigners())[0].address);

    return {
      users,
      balance,
      testERC20,
      staking,
      delegator,
      voting,
      target,
      target2,
      snapshotInterval,
      sponsorWindow,
      votingStartOffset,
      votingYesEndOffset,
      votingNoEndOffset,
      executionStartOffset,
      executionEndOffset,
      quorum,
      proposalSponsorThreshold,
      sponsorLockoutTime,
    };
  }

  it('Should go through vote lifecycle', async () => {
    const {
      users,
      balance,
      voting,
      target,
      sponsorWindow,
      votingStartOffset,
      votingYesEndOffset,
      votingNoEndOffset,
      executionStartOffset,
      executionEndOffset,
      quorum,
      proposalSponsorThreshold,
    } = await loadFixture(deploy);

    // Proposals should contain actions
    await expect(voting.createProposal(proposalDocument, [])).to.be.revertedWith(
      'Voting: No actions specified',
    );

    // Create proposal
    await expect(
      voting.createProposal(proposalDocument, [
        {
          callContract: target.address,
          data: target.interface.encodeFunctionData('a'),
          value: 0,
        },
      ]),
    )
      .to.emit(voting, 'Proposal')
      .withArgs(0, users[0].address);

    // Should increment proposal length
    expect(await voting.proposalsLength()).to.equal(1);

    // Check actions are set correctly
    const actions = await voting.getActions(0);
    expect(actions[0].callContract).to.equal(target.address);
    expect(actions[0].data).to.equal(target.interface.encodeFunctionData('a'));
    expect(actions[0].value).to.equal(0);

    // Get proposal document
    let proposal = await voting.proposals(0);

    // Check it has been correctly created
    expect(proposal.proposer).to.equal((await ethers.getSigners())[0].address);
    expect(proposal.proposalDocument).to.equal(proposalDocument);
    expect(proposal.publishTime).to.not.equal(0);
    expect(proposal.voteCallTime).to.equal(0);
    expect(proposal.sponsorInterval).to.equal(1);

    // Trying to cast vote should fail
    await expect(voting.vote(0, 100, true, users[0].address, 0)).to.be.revertedWith(
      "Voting: Vote hasn't been called for this proposal",
    );

    // Trying to execute should fail
    await expect(voting.executeProposal(0)).to.be.revertedWith(
      "Voting: Vote hasn't been called for this proposal",
    );

    // Sponsor proposal
    await expect(voting.sponsorProposal(0, proposalSponsorThreshold, users[0].address, 0))
      .to.emit(voting, 'Sponsorship')
      .withArgs(0, users[0].address, proposalSponsorThreshold);

    // Check sponsored is logged correctly
    expect(await voting.getSponsored(0, users[0].address)).to.equal(proposalSponsorThreshold);

    // Sponsoring with more than voting power should fail
    await expect(voting.sponsorProposal(0, balance, users[0].address, 0)).to.be.revertedWith(
      'Voting: Not enough voting power',
    );

    // Trying to cast vote should fail
    await expect(voting.vote(0, 100, true, users[0].address, 0)).to.be.revertedWith(
      "Voting: Vote hasn't been called for this proposal",
    );

    // Trying to execute should fail
    await expect(voting.executeProposal(0)).to.be.revertedWith(
      "Voting: Vote hasn't been called for this proposal",
    );

    // Unsponsor vote
    await expect(voting.unsponsorProposal(0, proposalSponsorThreshold, users[0].address))
      .to.emit(voting, 'SponsorshipRevocation')
      .withArgs(0, users[0].address, proposalSponsorThreshold);

    // Check sponsored is logged correctly
    expect(await voting.getSponsored(0, users[0].address)).to.equal(0);

    // Unsponsoring more than sponsored should fail
    await expect(
      voting.unsponsorProposal(0, proposalSponsorThreshold, users[0].address),
    ).to.be.revertedWith('Voting: Amount greater than sponsored');

    // Trying to call vote should fail
    await expect(voting.callVote(0)).to.be.revertedWith('Voting: Sponsor threshold not met');

    // Sponsor proposal again
    await voting.sponsorProposal(0, proposalSponsorThreshold, users[0].address, 0);

    // Take snapshot
    const preSponsorshipWindowEndSnapshot = await takeSnapshot();

    // Increase time to after sponsorship window
    await time.increase(sponsorWindow);

    // Sponsor should fail
    await expect(
      voting.sponsorProposal(0, proposalSponsorThreshold, users[0].address, 0),
    ).to.be.revertedWith('Voting: Sponsoring window passed');

    // Unsponsor should fail
    await expect(
      voting.unsponsorProposal(0, proposalSponsorThreshold, users[0].address),
    ).to.be.revertedWith('Voting: Sponsoring window passed');

    // Call vote should fail
    await expect(voting.callVote(0)).to.be.revertedWith('Voting: Sponsoring window passed');

    // Restore snapshot
    await preSponsorshipWindowEndSnapshot.restore();

    // Send to vote
    await expect(voting.callVote(0)).to.emit(voting, 'VoteCall').withArgs(0);

    // Check proposal document has been updated
    proposal = await voting.proposals(0);
    expect(proposal.voteCallTime).to.not.equal(0);
    expect(proposal.votingInterval).to.equal(1);

    // Trying to call vote should fail
    await expect(voting.callVote(0)).to.be.revertedWith('Voting: Proposal already gone to vote');

    // Sponsor should fail
    await expect(
      voting.sponsorProposal(0, proposalSponsorThreshold, users[0].address, 0),
    ).to.be.revertedWith('Voting: Gone to vote');

    // Unsponsor should fail
    await expect(
      voting.unsponsorProposal(0, proposalSponsorThreshold, users[0].address),
    ).to.be.revertedWith('Voting: Gone to vote');

    // Trying to execute should fail
    await expect(voting.executeProposal(0)).to.be.revertedWith(
      "Voting: Quorum hasn't been reached",
    );

    // Trying to vote should fail
    await expect(voting.vote(0, quorum, true, users[0].address, 0)).to.be.revertedWith(
      "Voting: Voting window hasn't opened",
    );

    // Increase time to voting window
    await time.increase(votingStartOffset);

    // Cast vote
    await expect(voting.vote(0, quorum * 2n, true, users[0].address, 0))
      .to.emit(voting, 'VoteCast')
      .withArgs(0, users[0].address, true, quorum * 2n);

    // Check vote is logged correctly
    expect(await voting.getVotes(0, users[0].address)).to.equal(quorum * 2n);

    // Shouldn't be able to vote with more than voting power
    await expect(voting.vote(0, balance, true, users[0].address, 0)).to.be.revertedWith(
      'Voting: Not enough voting power to cast this vote',
    );

    // Check proposal document has been updated
    proposal = await voting.proposals(0);
    expect(proposal.yayVotes).to.equal(quorum * 2n);

    // Trying to execute should fail
    await expect(voting.executeProposal(0)).to.be.revertedWith(
      "Voting: Execution window hasn't opened",
    );

    // Increase time to yes window end
    await time.increase(votingYesEndOffset - votingStartOffset);

    // Vote yes should fail
    await expect(voting.vote(0, quorum, true, users[0].address, 0)).to.be.revertedWith(
      'Voting: Affirmative voting window has closed',
    );

    // Take snapshot pre-veto
    const preVetoSnapshot = await takeSnapshot();

    // Cast a no vote to veto proposal
    await expect(voting.vote(0, quorum * 10n, false, users[0].address, 0))
      .to.emit(voting, 'VoteCast')
      .withArgs(0, users[0].address, false, quorum * 10n);

    expect(await voting.getVotes(0, users[0].address)).to.equal(quorum * 12n);

    // Check proposal document has been updated
    proposal = await voting.proposals(0);
    expect(proposal.nayVotes).to.equal(quorum * 10n);

    // Increase time to no window end
    await time.increase(votingNoEndOffset - votingYesEndOffset);

    // Vote no should fail
    await expect(voting.vote(0, quorum, false, users[0].address, 0)).to.be.revertedWith(
      'Voting: Negative voting window has closed',
    );

    // Increase time to execution window start
    await time.increase(executionStartOffset - votingNoEndOffset);

    // Execute should fail
    await expect(voting.executeProposal(0)).to.be.revertedWith(
      "Voting: Proposal hasn't passed vote",
    );

    // Restore pre-veto snapshot
    await preVetoSnapshot.restore();

    // Increase time to execution start offset
    await time.increase(executionStartOffset - votingNoEndOffset);

    // Take snapshot
    const preExecuteSnapshot = await takeSnapshot();

    // Increase time to execution window end
    await time.increase(executionEndOffset - votingNoEndOffset);

    // Execute should fail
    await expect(voting.executeProposal(0)).to.be.revertedWith(
      'Voting: Execution window has closed',
    );

    // Restore to snapshot
    await preExecuteSnapshot.restore();

    // Increase time to execution window start
    await time.increase(executionStartOffset - votingNoEndOffset);

    // Execute should pass
    await expect(voting.executeProposal(0)).to.emit(voting, 'Execution').withArgs(0);

    // Execute should fail
    await expect(voting.executeProposal(0)).to.be.revertedWith(
      'Voting: Proposal has already been executed',
    );
  });

  it('Should execute proposals', async () => {
    const {
      users,
      voting,
      target2,
      votingStartOffset,
      executionStartOffset,
      quorum,
      proposalSponsorThreshold,
    } = await loadFixture(deploy);

    // Create proposal
    await voting.createProposal(proposalDocument, [
      {
        callContract: target2.address,
        data: target2.interface.encodeFunctionData('changeGreeting', ['hi']),
        value: 0,
      },
    ]);

    // Sponsor proposal
    await voting.sponsorProposal(0, proposalSponsorThreshold, users[0].address, 0);

    // Send to vote
    await voting.callVote(0);

    // Increase time to voting window
    await time.increase(votingStartOffset);

    // Cast vote
    await voting.vote(0, quorum, true, users[0].address, 0);

    // Increase time to execution window start
    await time.increase(executionStartOffset - votingStartOffset);

    // Check greeter before
    expect(await target2.greeting()).to.equal('hello');

    // Execute proposal
    await voting.executeProposal(0);

    // Check greeter has changed
    expect(await target2.greeting()).to.equal('hi');
  });

  it('Should throw error on failed proposal', async () => {
    const {
      users,
      voting,
      target,
      votingStartOffset,
      executionStartOffset,
      quorum,
      proposalSponsorThreshold,
    } = await loadFixture(deploy);

    // Create proposal
    await voting.createProposal(proposalDocument, [
      {
        callContract: target.address,
        data: target.interface.encodeFunctionData('willRevert'),
        value: 0,
      },
    ]);

    // Sponsor proposal
    await voting.sponsorProposal(0, proposalSponsorThreshold, users[0].address, 0);

    // Send to vote
    await voting.callVote(0);

    // Increase time to voting window
    await time.increase(votingStartOffset);

    // Cast vote
    await voting.vote(0, quorum, true, users[0].address, 0);

    // Increase time to execution window start
    await time.increase(executionStartOffset - votingStartOffset);

    // Execute proposal and expect error
    await expect(voting.executeProposal(0)).to.be.reverted;
  });

  it('Should only be able to sponsor once per week', async () => {
    const { users, voting, target, proposalSponsorThreshold, sponsorLockoutTime } =
      await loadFixture(deploy);

    // Create 2 proposals
    await voting.createProposal(proposalDocument, [
      {
        callContract: target.address,
        data: target.interface.encodeFunctionData('a'),
        value: 0,
      },
    ]);

    await voting.createProposal(proposalDocument, [
      {
        callContract: target.address,
        data: target.interface.encodeFunctionData('a'),
        value: 0,
      },
    ]);

    // Sponsor first proposal
    await voting.sponsorProposal(0, proposalSponsorThreshold, users[0].address, 0);

    // Sponsor second proposal should fail
    await expect(
      voting.sponsorProposal(1, proposalSponsorThreshold, users[0].address, 0),
    ).to.be.revertedWith('Voting: Can only sponsor one proposal per week');

    // Increase time to sponsor lockout time end
    await time.increase(sponsorLockoutTime);

    // Sponsor second proposal should pass now
    await expect(voting.sponsorProposal(1, proposalSponsorThreshold, users[0].address, 0)).to.be
      .fulfilled;
  });

  it('Should only allow voting key to call', async () => {
    const { users, voting, target, proposalSponsorThreshold } = await loadFixture(deploy);

    // Get second user
    const voting2 = voting.connect(users[1]);

    // Create proposal
    await voting.createProposal(proposalDocument, [
      {
        callContract: target.address,
        data: target.interface.encodeFunctionData('a'),
        value: 0,
      },
    ]);

    // Sponsor, unsponsor, and vote without permission should fail
    await expect(
      voting2.sponsorProposal(0, proposalSponsorThreshold, users[0].address, 0n),
    ).to.be.revertedWith('Voting: Caller not authorized');

    await expect(
      voting2.unsponsorProposal(0, proposalSponsorThreshold, users[0].address),
    ).to.be.revertedWith('Voting: Caller not authorized');

    await expect(
      voting2.vote(0, proposalSponsorThreshold, true, users[0].address, 0n),
    ).to.be.revertedWith('Voting: Caller not authorized');

    // Set voting key
    await expect(voting.setVotingKey(users[1].address))
      .to.emit(voting, 'VoteKeySet')
      .withArgs(users[0].address, users[1].address);

    // Sponsor with permission should pass
    await expect(voting2.sponsorProposal(0, proposalSponsorThreshold, users[0].address, 0)).to.be
      .fulfilled;
  });
});
