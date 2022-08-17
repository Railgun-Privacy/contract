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
  it('Should retrieve snapshot sequence correctly', async function () {
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
  it('Should precalculate global snapshots correctly', async function () {
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

    await governorRewards.prefetchGlobalSnapshots(
      0,
      votingPower.length - 1,
      votingPower.map((val, index) => index * stakingDistributionIntervalMultiplier),
    );
  });

  it('Should earmark correctly', async () => {
    // Stake tokens
    await staking.stake(100n);

    // Fast forward to first interval
    await hre.ethers.provider.send('evm_increaseTime', [distributionInterval]);
    await hre.ethers.provider.send('evm_mine');

    await governorRewards.prefetchGlobalSnapshots(0, 1, [0, 0]);

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
      await governorRewards.earmark(distributionTokens[i].address);

      // Get treasury balance after earmark
      // eslint-disable-next-line no-await-in-loop
      const treasuryBalanceAfterEarmark = BigInt(
        // eslint-disable-next-line no-await-in-loop
        await distributionTokens[i].balanceOf(treasury.address),
      );

      // Check that the right amount was subtracted from treasury
      expect(treasuryBalanceBeforeEarmark - treasuryBalanceAfterEarmark).to.equal(
        (treasuryBalanceBeforeEarmark * BigInt(i)) / BigInt(basisPoints),
      );

      // Check that the right amount was added to the fee distribution contract
      // eslint-disable-next-line no-await-in-loop
      expect(await distributionTokens[i].balanceOf(governorRewards.address)).to.equal(
        treasuryBalanceBeforeEarmark - treasuryBalanceAfterEarmark,
      );

      // Check that the right amount was entered in the earmarked record
      // eslint-disable-next-line no-await-in-loop
      expect(await governorRewards.earmarked(distributionTokens[i].address, 0)).to.equal(
        treasuryBalanceBeforeEarmark - treasuryBalanceAfterEarmark,
      );
    }
  });

  it('Shouldn\'t earmark if no tokens are staked', async () => {
    // Fast forward to first interval
    await hre.ethers.provider.send('evm_increaseTime', [distributionInterval]);
    await hre.ethers.provider.send('evm_mine');

    await governorRewards.prefetchGlobalSnapshots(0, 1, [0, 0]);

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
      await governorRewards.earmark(distributionTokens[i].address);

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
    }
  });
});
