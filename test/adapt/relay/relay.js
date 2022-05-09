/* global describe it beforeEach */
const hre = require('hardhat');
const { ethers } = require('hardhat');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

let snarkBypassSigner;
let treasuryAccount;
let testERC20;
let railgunLogic;

describe('Adapt/Relay', () => {
  beforeEach(async () => {
    await hre.network.provider.request({
      method: 'hardhat_setBalance',
      params: ['0x000000000000000000000000000000000000dEaD', '0x56BC75E2D63100000'],
    });
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: ['0x000000000000000000000000000000000000dEaD'],
    });
    snarkBypassSigner = await ethers.getSigner('0x000000000000000000000000000000000000dEaD');

    const accounts = await ethers.getSigners();
    [treasuryAccount] = accounts;

    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const PoseidonT4 = await ethers.getContractFactory('PoseidonT4');
    const poseidonT3 = await PoseidonT3.deploy();
    const poseidonT4 = await PoseidonT4.deploy();

    const RailgunLogic = await ethers.getContractFactory('RailgunLogic', {
      libraries: {
        PoseidonT3: poseidonT3.address,
        PoseidonT4: poseidonT4.address,
      },
    });
    railgunLogic = await RailgunLogic.deploy();
    railgunLogic = railgunLogic.connect(snarkBypassSigner);
    await railgunLogic.initializeRailgunLogic(
      treasuryAccount.address,
      25n,
      25n,
      25n,
      treasuryAccount.address,
    );

    const TestERC20 = await ethers.getContractFactory('TestERC20');
    testERC20 = await TestERC20.deploy();
    await testERC20.transfer('0x000000000000000000000000000000000000dEaD', 2n ** 256n - 1n);
    testERC20 = testERC20.connect(snarkBypassSigner);
    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);
  });

  it('Should calculate adapt params', async () => {
    
  });
});
