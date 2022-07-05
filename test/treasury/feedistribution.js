/* global describe it beforeEach */
const { ethers } = require('hardhat');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

let feeDistribution;
let rail;
let secondToken;
let treasury;
let staking;
let users;

describe('Treasury/FeeDistribution', () => {
  beforeEach(async () => {
    const signers = await ethers.getSigners();

    const FeeDistribution = await ethers.getContractFactory('FeeDistribution');
    const ERC20 = await ethers.getContractFactory('TestERC20');
    const Staking = await ethers.getContractFactory('Staking');
    const Treasury = await ethers.getContractFactory('Treasury');

    rail = await ERC20.deploy();
    secondToken = await ERC20.deploy();
    staking = await Staking.deploy(rail.address);
    treasury = await Treasury.deploy();
    feeDistribution = await FeeDistribution.deploy();

    users = signers.map((signer) => ({
      signer,
      rail: rail.connect(signer),
      secondToken: secondToken.connect(signer),
      staking: staking.connect(signer),
      feeDistribution: feeDistribution.connect(signer),
    }));

    await treasury.initializeTreasury(
      users[0].signer.address,
    );

    await feeDistribution.initializeFeeDistribution(
      users[0].signer.address,
      staking.address,
    );
  });

  it('Should earmark correctly', async () => {});
});
