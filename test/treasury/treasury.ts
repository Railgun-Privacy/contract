import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, setBalance } from '@nomicfoundation/hardhat-network-helpers';

describe('Treasury/Treasury', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    const Treasury = await ethers.getContractFactory('Treasury');
    const ERC20 = await ethers.getContractFactory('TestERC20');

    // Get signers
    const [primaryAccount, secondaryAccount] = await ethers.getSigners();

    const treasury = await Treasury.deploy();
    const treasurySecondary = treasury.connect(secondaryAccount);

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
    await setBalance(treasury.address, 10000);

    return { treasury, treasurySecondary, erc20, primaryAccount, secondaryAccount };
  }

  it('Should transfer ETH', async () => {
    const { treasury, treasurySecondary, secondaryAccount } = await loadFixture(deploy);

    // Should prevent burning
    await expect(treasury.transferETH(ethers.constants.AddressZero, 1000)).to.be.revertedWith(
      'Treasury: Preventing accidental burn',
    );

    // Should prevent accounts without role from calling
    await expect(
      treasurySecondary.transferETH((await ethers.getSigners())[0].address, 1000),
    ).to.be.revertedWith(
      `AccessControl: account ${secondaryAccount.address.toLowerCase()} is missing role ${await treasury.TRANSFER_ROLE()}`,
    );

    // Transfer should adjust balances
    await expect(
      treasury.transferETH((await ethers.getSigners())[0].address, 1000),
    ).to.changeEtherBalances(
      [treasury.address, (await ethers.getSigners())[0].address],
      [-1000, 1000],
    );

    // Remove ETH from treasury
    await setBalance(treasury.address, 0);

    // Transfer should fail
    await expect(
      treasury.transferETH((await ethers.getSigners())[0].address, 1000),
    ).to.be.revertedWith('Failed to send Ether');
  });

  it('Should transfer ERC20', async () => {
    const { treasury, treasurySecondary, erc20, secondaryAccount } = await loadFixture(deploy);

    // Should prevent burning
    await expect(
      treasury.transferERC20(erc20.address, ethers.constants.AddressZero, 1000),
    ).to.be.revertedWith('Treasury: Preventing accidental burn');

    // Should prevent accounts without role from calling
    await expect(
      treasurySecondary.transferERC20(erc20.address, (await ethers.getSigners())[0].address, 1000),
    ).to.be.revertedWith(
      `AccessControl: account ${secondaryAccount.address.toLowerCase()} is missing role ${await treasury.TRANSFER_ROLE()}`,
    );

    // Transfer should adjust balances
    await expect(
      treasury.transferERC20(erc20.address, (await ethers.getSigners())[0].address, 1000),
    ).to.changeTokenBalances(
      erc20,
      [treasury.address, (await ethers.getSigners())[0].address],
      [-1000, 1000],
    );
  });

  it("Shouldn't double init", async () => {
    const { treasury } = await loadFixture(deploy);

    await expect(
      treasury.initializeTreasury((await ethers.getSigners())[0].address),
    ).to.be.revertedWith('Initializable: contract is already initialized');
  });
});
