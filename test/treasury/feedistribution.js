/* global describe it beforeEach */
const hre = require('hardhat');
const { ethers } = require('hardhat');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

let feeDistribution;
let rail;
let distributionTokens;
let treasury;
let staking;
let users;
let distributionInterval;
let basisPoints;

describe('Treasury/FeeDistribution', () => {
  beforeEach(async () => {
    // Get signers list
    const signers = await ethers.getSigners();

    // Get contracts
    const FeeDistribution = await ethers.getContractFactory('FeeDistribution');
    const ERC20 = await ethers.getContractFactory('TestERC20');
    const Staking = await ethers.getContractFactory('Staking');
    const Treasury = await ethers.getContractFactory('Treasury');

    // Deploy contracts
    rail = await ERC20.deploy();
    staking = await Staking.deploy(rail.address);
    treasury = await Treasury.deploy();
    feeDistribution = await FeeDistribution.deploy();

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
      feeDistribution: feeDistribution.connect(signer),
    }));

    // Initialize contracts
    await treasury.initializeTreasury(
      users[0].signer.address,
    );

    await feeDistribution.initializeFeeDistribution(
      users[0].signer.address,
      staking.address,
      treasury.address,
      0n,
      distributionTokens.map((token) => token.address),
    );

    // Set all distribution tokens to distribute
    await feeDistribution.addTokens(distributionTokens.map((token) => token.address));

    // Get constants
    distributionInterval = (await feeDistribution.DISTRIBUTION_INTERVAL()).toNumber();
    basisPoints = (await feeDistribution.BASIS_POINTS()).toNumber();

    // Send distribution tokens balance to treasury
    await Promise.all(distributionTokens.map(async (token) => {
      await token.transfer(treasury.address, 100000n * 10n ** 18n);
    }));

    // Set fee distribution interval
    await feeDistribution.setIntervalBP(10n);

    // Give fee distribution contract transfer role
    await treasury.grantRole(await treasury.TRANSFER_ROLE(), feeDistribution.address);
  });

  it('Should earmark correctly', async () => {
    // Fast forward to first interval
    await hre.ethers.provider.send('evm_increaseTime', [distributionInterval]);
    await hre.ethers.provider.send('evm_mine');

    for (let i = 0; i < distributionTokens; i += 1) {
      // Set fee distribution interval
      // eslint-disable-next-line no-await-in-loop
      await feeDistribution.setIntervalBP(BigInt(i));

      // Get treasury balance before earmark
      // eslint-disable-next-line no-await-in-loop
      const treasuryBalanceBeforeEarmark = await distributionTokens[0].balanceOf(treasury.address);

      // Earmark token
      // eslint-disable-next-line no-await-in-loop
      await feeDistribution.earmark(distributionTokens[0].address);

      // Get treasury balance after earmark
      // eslint-disable-next-line no-await-in-loop
      const treasuryBalanceAfterEarmark = await distributionTokens[0].balanceOf(treasury.address);

      // Check that the right amount was subtracted from treasury
      expect(treasuryBalanceBeforeEarmark - treasuryBalanceAfterEarmark).to.equal(
        (treasuryBalanceBeforeEarmark * BigInt(i)) / BigInt(basisPoints),
      );

      // Check that the right amount was added to the fee distribution contract
      // eslint-disable-next-line no-await-in-loop
      expect(await distributionTokens[0].balanceOf(feeDistribution.address)).to.equal(
        treasuryBalanceBeforeEarmark - treasuryBalanceAfterEarmark,
      );

      // Check that the right amount was entered in the earmarked record
      // eslint-disable-next-line no-await-in-loop
      expect(await feeDistribution.earmarked(distributionTokens[0].address, 0n)).to.equal(
        treasuryBalanceBeforeEarmark - treasuryBalanceAfterEarmark,
      );
    }
  });
});
