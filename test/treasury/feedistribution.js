/* global describe it beforeEach */
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

    // Get distribution interval time
    distributionInterval = await feeDistribution.DISTRIBUTION_INTERVAL();

    // Send distribution tokens balance to treasury
    await Promise.all(distributionTokens.map(async (token) => {
      const balance = await token.balanceOf(users[0].signer.address);
      await token.transfer(treasury.address, balance);
    }));
  });

  it('Should earmark correctly', async () => {

  });
});
