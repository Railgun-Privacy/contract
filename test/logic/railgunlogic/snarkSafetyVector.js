/* eslint-disable func-names */
/* global describe it beforeEach */
const { ethers } = require('hardhat');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

let railgunLogic;
let primaryAccount;
let treasuryAccount;
let proxy;

describe('Logic/RailgunLogic/SnarkSafetyVector', () => {
  beforeEach(async () => {
    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const PoseidonT4 = await ethers.getContractFactory('PoseidonT4');
    const poseidonT3 = await PoseidonT3.deploy();
    const poseidonT4 = await PoseidonT4.deploy();

    [primaryAccount, treasuryAccount] = await ethers.getSigners();

    const RailgunLogic = await ethers.getContractFactory('RailgunLogic', {
      libraries: {
        PoseidonT3: poseidonT3.address,
        PoseidonT4: poseidonT4.address,
      },
    });
    railgunLogic = await RailgunLogic.deploy();

    const Proxy = await ethers.getContractFactory('PausableUpgradableProxy');
    proxy = await Proxy.deploy(
      treasuryAccount.address,
    );
    proxy = proxy.connect(treasuryAccount);
    await proxy.upgrade(railgunLogic.address);
    railgunLogic = railgunLogic.attach(proxy.address);
    await proxy.unpause();

    await railgunLogic.initializeRailgunLogic(
      treasuryAccount.address,
      25n,
      25n,
      25n,
      primaryAccount.address,
    );
  });

  it('Should pass safety vector checks', async () => {
    await expect(railgunLogic.treasury()).to.eventually.be.fulfilled;
    await expect(railgunLogic.checkSafetyVectors()).to.eventually.be.rejected;
    await expect(railgunLogic.treasury()).to.eventually.be.fulfilled;
    await railgunLogic.addVector(BigInt(primaryAccount.address));
    await expect(railgunLogic.treasury()).to.eventually.be.fulfilled;
    await expect(railgunLogic.checkSafetyVectors()).to.eventually.be.fulfilled;
    await expect(railgunLogic.treasury()).to.eventually.be.rejected;
  });
});
