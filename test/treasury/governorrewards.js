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

    // Set all distribution tokens to distribute
    await governorRewards.addTokens(distributionTokens.map((token) => token.address));

    // Get constants
    distributionInterval = (await governorRewards.DISTRIBUTION_INTERVAL()).toNumber();
    basisPoints = (await governorRewards.BASIS_POINTS()).toNumber();

    // Send distribution tokens balance to treasury
    await Promise.all(distributionTokens.map(async (token) => {
      await token.transfer(treasury.address, 100000n * 10n ** 18n);
    }));

    // Set fee distribution interval
    await governorRewards.setIntervalBP(10n);

    // Give fee distribution contract transfer role
    await treasury.grantRole(await treasury.TRANSFER_ROLE(), governorRewards.address);
  });

  it('Should earmark correctly', async () => {
    // Fast forward to first interval
    await hre.ethers.provider.send('evm_increaseTime', [distributionInterval]);
    await hre.ethers.provider.send('evm_mine');

    for (let i = 0; i < distributionTokens; i += 1) {
      // Set fee distribution interval
      // eslint-disable-next-line no-await-in-loop
      await governorRewards.setIntervalBP(BigInt(i));

      // Get treasury balance before earmark
      // eslint-disable-next-line no-await-in-loop
      const treasuryBalanceBeforeEarmark = await distributionTokens[0].balanceOf(treasury.address);

      // Earmark token
      // eslint-disable-next-line no-await-in-loop
      await governorRewards.earmark(distributionTokens[0].address);

      // Get treasury balance after earmark
      // eslint-disable-next-line no-await-in-loop
      const treasuryBalanceAfterEarmark = await distributionTokens[0].balanceOf(treasury.address);

      // Check that the right amount was subtracted from treasury
      expect(treasuryBalanceBeforeEarmark - treasuryBalanceAfterEarmark).to.equal(
        (treasuryBalanceBeforeEarmark * BigInt(i)) / BigInt(basisPoints),
      );

      // Check that the right amount was added to the fee distribution contract
      // eslint-disable-next-line no-await-in-loop
      expect(await distributionTokens[0].balanceOf(governorRewards.address)).to.equal(
        treasuryBalanceBeforeEarmark - treasuryBalanceAfterEarmark,
      );

      // Check that the right amount was entered in the earmarked record
      // eslint-disable-next-line no-await-in-loop
      expect(await governorRewards.earmarked(distributionTokens[0].address, 0n)).to.equal(
        treasuryBalanceBeforeEarmark - treasuryBalanceAfterEarmark,
      );
    }
  });

  it('Should validate hints correctly', async () => {
    const stakingSnapshotInterval = Number((await staking.SNAPSHOT_INTERVAL()).toString());

    const snapshotIntervals = [];

    // Increast time to second interval
    await ethers.provider.send('evm_increaseTime', [stakingSnapshotInterval * 2]);
    await ethers.provider.send('evm_mine');

    // Loop through 10 intervals
    for (let i = 2; i < 15; i += 1) {
      // Random chance to take a snapshot
      if (Math.random() < 0.3) {
        // eslint-disable-next-line no-await-in-loop
        await staking.snapshotStub((await ethers.getSigners())[0].address);

        snapshotIntervals.push(i);
      }

      // Increase time to next interval
      // eslint-disable-next-line no-await-in-loop
      await ethers.provider.send('evm_increaseTime', [stakingSnapshotInterval]);
      // eslint-disable-next-line no-await-in-loop
      await ethers.provider.send('evm_mine');
    }

    // Increase time without taking snapshots
    await ethers.provider.send('evm_increaseTime', [stakingSnapshotInterval * 10]);
    await ethers.provider.send('evm_mine');

    for (let interval = 0; interval < 15; interval += 1) {
      for (let hint = 0; hint < 15; hint += 1) {
        const expectedHint = snapshotIntervals.findIndex((el) => el >= interval) >= 0
          ? snapshotIntervals.findIndex((el) => el >= interval)
          : snapshotIntervals.length;

        // eslint-disable-next-line no-await-in-loop
        expect(await governorRewards.validateGlobalSnapshotHint(
          BigInt(interval),
          BigInt(hint),
        )).to.equal(expectedHint === hint);

        // eslint-disable-next-line no-await-in-loop
        expect(await governorRewards.validateAccountSnapshotHint(
          BigInt(interval),
          // eslint-disable-next-line no-await-in-loop
          (await ethers.getSigners())[0].address,
          BigInt(hint),
        )).to.equal(expectedHint === hint);
      }
    }
  });
});
