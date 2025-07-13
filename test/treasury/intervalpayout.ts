import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, setBalance, time } from '@nomicfoundation/hardhat-network-helpers';

describe('Treasury/IntervalPayout', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    const Treasury = await ethers.getContractFactory('Treasury');
    const ERC20 = await ethers.getContractFactory('TestERC20');

    const treasury = await Treasury.deploy();

    // Initialize treasury with signer 0 as admin
    await treasury.initializeTreasury((await ethers.getSigners())[0].address);

    // Deploy ERC20
    const erc20 = await ERC20.deploy();
    await erc20.mint(await erc20.signer.getAddress(), 2n ** 256n - 1n);

    // Transfer ERC20 to treasury
    await erc20.transfer(
      treasury.address,
      await erc20.balanceOf((await ethers.getSigners())[0].address),
    );

    // Give ETH to treasury
    await setBalance(treasury.address, 100000000);

    return { treasury, erc20 };
  }

  it('Should payout on interval', async function () {
    this.timeout(5 * 60 * 60 * 1000);
    const { treasury } = await loadFixture(deploy);

    const totalPayouts = process.env.SKIP_LONG_TESTS ? 1 : 10;
    const amount = 100;
    const intervalTime = 10000;

    // Deploy and setup interval payout contract
    const IntervalPayouts = await ethers.getContractFactory('IntervalPayouts');
    const startTime = time.latest();
    const intervalPayouts = await IntervalPayouts.deploy(
      treasury.address,
      (
        await ethers.getSigners()
      )[1].address,
      ethers.constants.AddressZero,
      amount,
      intervalTime,
      totalPayouts,
      startTime,
    );
    await treasury.grantRole(await treasury.TRANSFER_ROLE(), intervalPayouts.address);

    for (let i = 0; i < totalPayouts; i += 1) {
      // Check that payout is ready
      expect(await intervalPayouts.ready()).to.equal(true);

      // Process payout
      await expect(intervalPayouts.payout()).to.changeEtherBalances(
        [treasury.address, (await ethers.getSigners())[1].address],
        [-amount, amount],
      );

      // Check that it correctly prevents payouts until next interval
      expect(await intervalPayouts.ready()).to.equal(false);

      await expect(intervalPayouts.payout()).to.be.revertedWith(
        'IntervalPayouts: Payout not ready',
      );

      // Fast forward time to next interval
      await time.increase(intervalTime);
    }

    // Should prevent payouts after the last interval
    for (let i = 0; i < totalPayouts; i += 1) {
      expect(await intervalPayouts.ready()).to.equal(false);
      await expect(intervalPayouts.payout()).to.be.revertedWith(
        'IntervalPayouts: Payout not ready',
      );

      // Fast forward time to next interval
      await time.increase(intervalTime);
    }
  });

  it('Should payout ERC20', async function () {
    const { treasury, erc20 } = await loadFixture(deploy);

    const amount = 100;

    // Deploy and setup interval payout contract
    const IntervalPayouts = await ethers.getContractFactory('IntervalPayouts');
    const startTime = time.latest();
    const intervalPayouts = await IntervalPayouts.deploy(
      treasury.address,
      (
        await ethers.getSigners()
      )[1].address,
      erc20.address,
      amount,
      1,
      1,
      startTime,
    );
    await treasury.grantRole(await treasury.TRANSFER_ROLE(), intervalPayouts.address);

    // Check that erc20 tokens are sent
    await expect(intervalPayouts.payout()).to.changeTokenBalances(
      erc20,
      [treasury.address, (await ethers.getSigners())[1].address],
      [-amount, amount],
    );
  });
});
