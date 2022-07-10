/* global describe it beforeEach */
const { ethers } = require('hardhat');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

let treasuryOld;
let migration;

describe('Treasury/Migration', () => {
  beforeEach(async () => {
    const TreasuryOld = await ethers.getContractFactory('TreasuryOld');
    const Migration = await ethers.getContractFactory('TreasuryMigration');

    treasuryOld = await TreasuryOld.deploy((await ethers.getSigners())[0].address);
    migration = await Migration.deploy(
      treasuryOld.address,
      (await ethers.getSigners())[1].address,
    );

    await treasuryOld.transferOwnership(migration.address);
  });

  it('Should migrate ETH', async () => {
    // Send ETH to old treasury
    await (await ethers.getSigners())[0].sendTransaction({
      to: treasuryOld.address,
      value: 1000n,
    });

    // Check old treasury has balance
    expect(await ethers.provider.getBalance(treasuryOld.address)).to.equal(1000n);

    // Get before eth balance of new treasury address
    const newTreasuryEthBalanceBefore = await ethers.provider.getBalance(
      (await ethers.getSigners())[1].address,
    );

    // Migrate ETH
    await migration.migrateETH();

    // Check ETH has been removed from old treasury
    expect(await ethers.provider.getBalance(treasuryOld.address)).to.equal(0n);

    // Get after eth balance of new treasury address
    const newTreasuryEthBalanceAfter = await ethers.provider.getBalance(
      (await ethers.getSigners())[1].address,
    );

    // Check the right amount of ETH has been transferred
    expect(newTreasuryEthBalanceAfter.sub(newTreasuryEthBalanceBefore)).to.equal(1000n);
  });

  it('Should migrate ERC20', async () => {
    // Deploy test ERC20
    const ERC20 = await ethers.getContractFactory('TestERC20');
    const erc20 = await ERC20.deploy();

    // Send test ERC20 to old treasury
    await erc20.transfer(treasuryOld.address, 1000n);

    // Check old treasury has balance
    expect(await erc20.balanceOf(treasuryOld.address)).to.equal(1000n);

    // Get before ERC20 balance of new treasury address
    const newTreasuryERC20BalanceBefore = await erc20.balanceOf(
      (await ethers.getSigners())[1].address,
    );

    // Migrate ERC20
    await migration.migrateERC20([erc20.address]);

    // Check ERC20 has been removed from old treasury
    expect(await erc20.balanceOf(treasuryOld.address)).to.equal(0n);

    // Get after eth balance of new treasury address
    const newTreasuryERC20BalanceAfter = await erc20.balanceOf(
      (await ethers.getSigners())[1].address,
    );

    // Check the right amount of ERC20 has been transferred
    expect(newTreasuryERC20BalanceAfter.sub(newTreasuryERC20BalanceBefore)).to.equal(1000n);
  });
});
