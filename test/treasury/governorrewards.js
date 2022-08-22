/* global describe it beforeEach */
const hre = require('hardhat');
const { ethers } = require('hardhat');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

let governorRewards;
let rail;
let distributionTokens;
let treasury;
let staking;
let users;
let distributionInterval;
let stakingInterval;
let stakingDistributionIntervalMultiplier;
let basisPoints;

describe('Treasury/GovernorRewards', () => {
  beforeEach(async () => {
    // Get signers list
    const signers = await ethers.getSigners();

    // Get contracts
    const GovernorRewards = await ethers.getContractFactory('GovernorRewards');
    const ERC20 = await ethers.getContractFactory('TestERC20');
    const Staking = await ethers.getContractFactory('StakingStub');
    const Treasury = await ethers.getContractFactory('Treasury');

    // Deploy contracts
    rail = await ERC20.deploy();
    staking = await Staking.deploy(rail.address);
    treasury = await Treasury.deploy();
    governorRewards = await GovernorRewards.deploy();

    // Deploy a bunch of tokens to use as distribution tokens
    distributionTokens = await Promise.all(
      new Array(12).fill(1).map(() => ERC20.deploy()),
    );

    // Setup contract connections for each signer
    users = signers.map((signer) => ({
      signer,
      rail: rail.connect(signer),
      distributionTokens: distributionTokens.map((token) => token.connect(signer)),
      staking: staking.connect(signer),
      governorRewards: governorRewards.connect(signer),
    }));

    // Send staking tokens to each signer and allow staking
    for (let i = 0; i < users.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await rail.transfer(users[i].signer.address, 100000n);

      // eslint-disable-next-line no-await-in-loop
      await users[i].rail.approve(staking.address, 2n ** 256n - 1n);
    }

    // Initialize contracts
    await treasury.initializeTreasury(
      users[0].signer.address,
    );

    await governorRewards.initializeGovernorRewards(
      users[0].signer.address,
      staking.address,
      treasury.address,
      0n,
      distributionTokens.map((token) => token.address),
    );

    // Send distribution tokens balance to treasury
    await Promise.all(distributionTokens.map(async (token) => {
      await token.transfer(treasury.address, 100000n * 10n ** 18n);
    }));

    // Set fee distribution interval
    await governorRewards.setIntervalBP(10n);

    // Get constants
    stakingDistributionIntervalMultiplier = (
      await governorRewards.STAKING_DISTRIBUTION_INTERVAL_MULTIPLIER()
    ).toNumber();
    distributionInterval = (await governorRewards.DISTRIBUTION_INTERVAL()).toNumber();
    basisPoints = (await governorRewards.BASIS_POINTS()).toNumber();
    stakingInterval = (await staking.SNAPSHOT_INTERVAL()).toNumber();

    // Give fee distribution contract transfer role
    await treasury.grantRole(await treasury.TRANSFER_ROLE(), governorRewards.address);
  });

  // eslint-disable-next-line func-names
  it('Should retrieve snapshot sequence', async function () {
    let intervals = 50;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      intervals = 100;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      intervals = 1000;
    }

    // Increase time to first interval
    await ethers.provider.send('evm_increaseTime', [stakingInterval]);
    await ethers.provider.send('evm_mine');

    let currentVotingPower = 0;
    const votingPower = [0];

    // Loop through and create intervals
    for (let i = 1; i < intervals; i += 1) {
      // Store voting power snapshot
      if (i % stakingDistributionIntervalMultiplier === 0) {
        votingPower.push(currentVotingPower);
      }

      // Random chance to stake
      if (Math.random() < 0.3) {
        // eslint-disable-next-line no-await-in-loop
        await staking.stake(100);
        currentVotingPower += 100;
      }

      // Increase time to next interval
      // eslint-disable-next-line no-await-in-loop
      await ethers.provider.send('evm_increaseTime', [stakingInterval]);
      // eslint-disable-next-line no-await-in-loop
      await ethers.provider.send('evm_mine');
    }

    // Check account with correct hints
    expect((await governorRewards.fetchAccountSnapshots(
      0,
      votingPower.length - 1,
      users[0].signer.address,
      votingPower.map((val, index) => index * stakingDistributionIntervalMultiplier),
    )).map((val) => val.toNumber())).to.deep.equal(votingPower);

    // Check account with incorrect hints
    expect((await governorRewards.fetchAccountSnapshots(
      0,
      votingPower.length - 1,
      users[0].signer.address,
      votingPower.map(() => 0),
    )).map((val) => val.toNumber())).to.deep.equal(votingPower);

    // Check global with correct hints
    expect((await governorRewards.fetchGlobalSnapshots(
      0,
      votingPower.length - 1,
      votingPower.map((val, index) => index * stakingDistributionIntervalMultiplier),
    )).map((val) => val.toNumber())).to.deep.equal(votingPower);

    // Check global with incorrect hints
    expect((await governorRewards.fetchGlobalSnapshots(
      0,
      votingPower.length - 1,
      votingPower.map(() => 0),
    )).map((val) => val.toNumber())).to.deep.equal(votingPower);
  });

  // eslint-disable-next-line func-names
  it('Should precalculate global snapshots', async function () {
    let intervals = 50;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      intervals = 100;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      intervals = 1000;
    }

    // Increase time to first interval
    await ethers.provider.send('evm_increaseTime', [stakingInterval]);
    await ethers.provider.send('evm_mine');

    let currentVotingPower = 0;
    const votingPower = [0];

    // Loop through and create intervals
    for (let i = 1; i < intervals; i += 1) {
      // Store voting power snapshot
      if (i % stakingDistributionIntervalMultiplier === 0) {
        votingPower.push(currentVotingPower);
      }

      // Random chance to stake
      if (Math.random() < 0.3) {
        // eslint-disable-next-line no-await-in-loop
        await staking.stake(100);
        currentVotingPower += 100;
      }

      // Increase time to next interval
      // eslint-disable-next-line no-await-in-loop
      await ethers.provider.send('evm_increaseTime', [stakingInterval]);
      // eslint-disable-next-line no-await-in-loop
      await ethers.provider.send('evm_mine');
    }

    // Prefetch global snapshots
    await governorRewards.prefetchGlobalSnapshots(
      0,
      votingPower.length - 1,
      votingPower.map((val, index) => index * stakingDistributionIntervalMultiplier),
      [],
    );

    // Check fetched values
    for (let i = 0; i < votingPower.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect(await governorRewards.precalculatedGlobalSnapshots(i)).to.equal(votingPower[i]);
    }
  });

  it('Should earmark', async () => {
    // Stake tokens
    await staking.stake(100n);

    // Fast forward to first interval
    await hre.ethers.provider.send('evm_increaseTime', [distributionInterval]);
    await hre.ethers.provider.send('evm_mine');

    for (let i = 0; i < distributionTokens.length; i += 1) {
      // Set fee distribution interval
      // eslint-disable-next-line no-await-in-loop
      await governorRewards.setIntervalBP(i);

      // Get treasury balance before earmark
      const treasuryBalanceBeforeEarmark = BigInt(
        // eslint-disable-next-line no-await-in-loop
        await distributionTokens[i].balanceOf(treasury.address),
      );

      // Earmark token
      // eslint-disable-next-line no-await-in-loop
      await governorRewards.prefetchGlobalSnapshots(0, 1, [0, 0], [distributionTokens[i].address]);

      // Get treasury balance after earmark
      // eslint-disable-next-line no-await-in-loop
      const treasuryBalanceAfterEarmark = BigInt(
        // eslint-disable-next-line no-await-in-loop
        await distributionTokens[i].balanceOf(treasury.address),
      );

      // Check that the right amount was subtracted from treasury
      expect((treasuryBalanceBeforeEarmark - treasuryBalanceAfterEarmark).toString()).to.equal(
        ((treasuryBalanceBeforeEarmark * BigInt(i)) / BigInt(basisPoints)).toString(),
      );

      // Check that the right amount was added to the fee distribution contract
      // eslint-disable-next-line no-await-in-loop
      expect(await distributionTokens[i].balanceOf(governorRewards.address)).to.equal(
        treasuryBalanceBeforeEarmark - treasuryBalanceAfterEarmark,
      );

      // Check that the right amount was entered in the earmarked record
      expect(
        // eslint-disable-next-line no-await-in-loop
        (BigInt(await governorRewards.earmarked(distributionTokens[i].address, 0))
        // eslint-disable-next-line no-await-in-loop
        + BigInt(await governorRewards.earmarked(distributionTokens[i].address, 1))).toString(),
      ).to.equal(
        (treasuryBalanceBeforeEarmark - treasuryBalanceAfterEarmark).toString(),
      );
    }
  });

  it('Shouldn\'t earmark if no tokens are staked', async () => {
    // Fast forward to first interval
    await hre.ethers.provider.send('evm_increaseTime', [distributionInterval]);
    await hre.ethers.provider.send('evm_mine');

    for (let i = 0; i < distributionTokens.length; i += 1) {
      // Set fee distribution interval
      // eslint-disable-next-line no-await-in-loop
      await governorRewards.setIntervalBP(i);

      // Get treasury balance before earmark
      const treasuryBalanceBeforeEarmark = BigInt(
        // eslint-disable-next-line no-await-in-loop
        await distributionTokens[i].balanceOf(treasury.address),
      );

      // Earmark token
      // eslint-disable-next-line no-await-in-loop
      await governorRewards.prefetchGlobalSnapshots(0, 1, [0, 0], [distributionTokens[i].address]);

      // Get treasury balance after earmark
      // eslint-disable-next-line no-await-in-loop
      const treasuryBalanceAfterEarmark = BigInt(
        // eslint-disable-next-line no-await-in-loop
        await distributionTokens[i].balanceOf(treasury.address),
      );

      // Check that nothing was subtracted from treasury
      expect(treasuryBalanceBeforeEarmark - treasuryBalanceAfterEarmark).to.equal(0n);

      // Check that nothing was added to the fee distribution contract
      // eslint-disable-next-line no-await-in-loop
      expect(await distributionTokens[i].balanceOf(governorRewards.address)).to.equal(0n);

      // Check that nothing was entered in the earmarked record
      // eslint-disable-next-line no-await-in-loop
      expect(await governorRewards.earmarked(distributionTokens[i].address, 0)).to.equal(0n);
      // eslint-disable-next-line no-await-in-loop
      expect(await governorRewards.earmarked(distributionTokens[i].address, 1)).to.equal(0n);
    }
  });

  it('Should calculate rewards', async () => {
    // Stake tokens
    await users[0].staking.stake(100n);
    await users[1].staking.stake(100n);

    // Increase time to 10th interval
    await ethers.provider.send('evm_increaseTime', [distributionInterval * 10]);
    await ethers.provider.send('evm_mine');

    // Prefetch data
    await governorRewards.prefetchGlobalSnapshots(
      0,
      9,
      new Array(10).fill(0),
      distributionTokens.map((token) => token.address),
    );

    // Calculate rewards
    const user1reward = (await governorRewards.calculateRewards(
      distributionTokens.map((token) => token.address),
      users[0].signer.address,
      0,
      9,
      new Array(10).fill(0),
      false,
    )).map(BigInt);

    const user2reward = (await governorRewards.calculateRewards(
      distributionTokens.map((token) => token.address),
      users[1].signer.address,
      0,
      9,
      new Array(10).fill(0),
      false,
    )).map(BigInt);

    // Rewards should be the same for equal stakes
    expect(user1reward).to.deep.equal(user2reward);

    // Get total rewards
    let totalRewards = 0n;
    for (let i = 0; i <= 9; i += 1) {
      const intervalEarmarked = BigInt(
        // eslint-disable-next-line no-await-in-loop
        await governorRewards.earmarked(distributionTokens[0].address, i),
      );

      totalRewards += intervalEarmarked / 2n;
    }

    // Check rewards are what we expect
    expect(user1reward[0].toString()).to.equal(totalRewards.toString());
  });

  it('Should claim', async () => {
    // Stake tokens
    await users[1].staking.stake(100n);
    await users[2].staking.stake(100n);

    // Increase time to 10th interval
    await ethers.provider.send('evm_increaseTime', [distributionInterval * 10]);
    await ethers.provider.send('evm_mine');

    // Prefetch data
    await governorRewards.prefetchGlobalSnapshots(
      0,
      9,
      new Array(10).fill(0),
      distributionTokens.map((token) => token.address),
    );

    // Claim rewards
    await governorRewards.claim(
      distributionTokens.map((token) => token.address),
      users[1].signer.address,
      0,
      9,
      new Array(10).fill(0),
    );

    await governorRewards.claim(
      distributionTokens.map((token) => token.address),
      users[2].signer.address,
      0,
      9,
      new Array(10).fill(0),
    );

    // Get total rewards
    let totalRewards = 0n;
    for (let i = 0; i <= 9; i += 1) {
      const intervalEarmarked = BigInt(
        // eslint-disable-next-line no-await-in-loop
        await governorRewards.earmarked(distributionTokens[0].address, i),
      );

      totalRewards += intervalEarmarked / 2n;
    }

    // Check rewards have been paid out
    expect(
      await distributionTokens[0].balanceOf(users[1].signer.address),
    ).to.equal(totalRewards);

    expect(
      await distributionTokens[0].balanceOf(users[2].signer.address),
    ).to.equal(totalRewards);

    // Calculate rewards should return 0 if ignoring claimed
    expect((await governorRewards.calculateRewards(
      distributionTokens.map((token) => token.address),
      users[1].signer.address,
      0,
      9,
      new Array(10).fill(0),
      true,
    ))[0]).to.equal(0n);

    // Calculate rewards should return original value if not ignoring claimed
    expect((await governorRewards.calculateRewards(
      distributionTokens.map((token) => token.address),
      users[1].signer.address,
      0,
      9,
      new Array(10).fill(0),
      false,
    ))[0]).to.equal(totalRewards);

    // Claiming rewards twice should move 0 coins
    await governorRewards.claim(
      distributionTokens.map((token) => token.address),
      users[1].signer.address,
      0,
      9,
      new Array(10).fill(0),
    );

    expect(
      await distributionTokens[0].balanceOf(users[1].signer.address),
    ).to.equal(totalRewards);
  });
});
