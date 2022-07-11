/* global describe it beforeEach */
const hre = require('hardhat');
const { ethers } = require('hardhat');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

let treasury;
let erc20;

describe('Treasury/IntervalPayout', () => {
  beforeEach(async () => {
    const Treasury = await ethers.getContractFactory('Treasury');

    treasury = await Treasury.deploy();
    await treasury.initializeTreasury((await ethers.getSigners())[0].address);

    const ERC20 = await ethers.getContractFactory('TestERC20');
    erc20 = await ERC20.deploy();
    await erc20.transfer(treasury.address, 100000000n);

    await (await ethers.getSigners())[0].sendTransaction({
      to: treasury.address,
      value: 100000000n,
    });
  });

  // eslint-disable-next-line func-names
  it('Should payout ETH', async function () {
    let totalPayouts = 1n;
    const amount = 100n;
    const intervalTime = 10000;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      totalPayouts = 10n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      totalPayouts = 100n;
    }

    // Get ETH balance before payouts
    const ethBalanceBefore = await ethers.provider.getBalance(
      (await ethers.getSigners())[1].address,
    );

    // Deploy and setup interval payout contract
    const IntervalPayouts = await ethers.getContractFactory('IntervalPayouts');
    const startTime = BigInt((await ethers.provider.getBlock()).timestamp);
    const intervalPayouts = await IntervalPayouts.deploy(
      treasury.address,
      (await ethers.getSigners())[1].address,
      ethers.constants.AddressZero,
      amount,
      intervalTime,
      totalPayouts,
      startTime,
    );
    await treasury.grantRole(await treasury.TRANSFER_ROLE(), intervalPayouts.address);

    for (let i = 0n; i < totalPayouts; i += 1n) {
      // Check that payout is ready
      // eslint-disable-next-line no-await-in-loop
      expect(await intervalPayouts.ready()).to.equal(true);

      // Process payout
      // eslint-disable-next-line no-await-in-loop
      await intervalPayouts.payout();

      // Get eth balance of beneficiary
      // eslint-disable-next-line no-await-in-loop
      const currentEthBalance = await ethers.provider.getBalance(
        // eslint-disable-next-line no-await-in-loop
        (await ethers.getSigners())[1].address,
      );

      // Check beneficiary eth balance is correct
      // eslint-disable-next-line no-undef
      expect(currentEthBalance.sub(ethBalanceBefore)).to.equal(amount * (i + 1n));

      // Check that it correctly prevents payouts until next interval
      // eslint-disable-next-line no-await-in-loop
      expect(await intervalPayouts.ready()).to.equal(false);

      // eslint-disable-next-line no-await-in-loop
      await expect(intervalPayouts.payout()).to.eventually.be.rejectedWith('IntervalPayouts: Payout not ready');

      // Fast forward time
      // eslint-disable-next-line no-await-in-loop
      await hre.ethers.provider.send('evm_increaseTime', [
        intervalTime,
      ]);

      // eslint-disable-next-line no-await-in-loop
      await hre.ethers.provider.send('evm_mine');
    }

    // Should prevent payouts after the last interval
    expect(await intervalPayouts.ready()).to.equal(false);
    await expect(intervalPayouts.payout()).to.eventually.be.rejectedWith('IntervalPayouts: Payout not ready');
  });

  // eslint-disable-next-line func-names
  it('Should payout ERC20', async function () {
    let totalPayouts = 1n;
    const amount = 100n;
    const intervalTime = 10000;

    if (process.env.LONG_TESTS === 'extra') {
      this.timeout(5 * 60 * 60 * 1000);
      totalPayouts = 10n;
    } else if (process.env.LONG_TESTS === 'complete') {
      this.timeout(5 * 60 * 60 * 1000);
      totalPayouts = 100n;
    }

    // Get ERC20 balance before payouts
    const ercBalanceBefore = await erc20.balanceOf(
      (await ethers.getSigners())[1].address,
    );

    // Deploy and setup interval payout contract
    const IntervalPayouts = await ethers.getContractFactory('IntervalPayouts');
    const startTime = BigInt((await ethers.provider.getBlock()).timestamp);
    const intervalPayouts = await IntervalPayouts.deploy(
      treasury.address,
      (await ethers.getSigners())[1].address,
      erc20.address,
      amount,
      intervalTime,
      totalPayouts,
      startTime,
    );
    await treasury.grantRole(await treasury.TRANSFER_ROLE(), intervalPayouts.address);

    for (let i = 0n; i < totalPayouts; i += 1n) {
      // Check that payout is ready
      // eslint-disable-next-line no-await-in-loop
      expect(await intervalPayouts.ready()).to.equal(true);

      // Process payout
      // eslint-disable-next-line no-await-in-loop
      await intervalPayouts.payout();

      // Get erc20 balance of beneficiary
      // eslint-disable-next-line no-await-in-loop
      const currentErcBalance = await erc20.balanceOf(
        // eslint-disable-next-line no-await-in-loop
        (await ethers.getSigners())[1].address,
      );

      // Check beneficiary eth balance is correct
      // eslint-disable-next-line no-undef
      expect(currentErcBalance.sub(ercBalanceBefore)).to.equal(amount * (i + 1n));

      // Check that it correctly prevents payouts until next interval
      // eslint-disable-next-line no-await-in-loop
      expect(await intervalPayouts.ready()).to.equal(false);

      // eslint-disable-next-line no-await-in-loop
      await expect(intervalPayouts.payout()).to.eventually.be.rejectedWith('IntervalPayouts: Payout not ready');

      // Fast forward time
      // eslint-disable-next-line no-await-in-loop
      await hre.ethers.provider.send('evm_increaseTime', [
        intervalTime,
      ]);

      // eslint-disable-next-line no-await-in-loop
      await hre.ethers.provider.send('evm_mine');
    }

    // Should prevent payouts after the last interval
    expect(await intervalPayouts.ready()).to.equal(false);
    await expect(intervalPayouts.payout()).to.eventually.be.rejectedWith('IntervalPayouts: Payout not ready');
  });
});
