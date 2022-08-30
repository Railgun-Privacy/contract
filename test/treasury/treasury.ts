import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, setBalance } from '@nomicfoundation/hardhat-network-helpers';

describe('Treasury/Treasury', () => {
  async function deploy() {
    const Treasury = await ethers.getContractFactory('Treasury');
    const ERC20 = await ethers.getContractFactory('TestERC20');

    const treasury = await Treasury.deploy();

    // Initialize treasury with signer 0 as admin
    await treasury.initializeTreasury((await ethers.getSigners())[0].address);

    // Deploy ERC20
    const erc20 = await ERC20.deploy();

    // Transfer ERC20 to treasury
    await erc20.transfer(
      treasury.address,
      await erc20.balanceOf((await ethers.getSigners())[0].address),
    );

    // Give ETH to treasury
    await setBalance(treasury.address, 10000);

    return { treasury, erc20 };
  }

  it('Should transfer ETH', async () => {
    const { treasury } = await loadFixture(deploy);

    // Should prevent burning
    await expect(treasury.transferETH(ethers.constants.AddressZero, 1000)).to.be.revertedWith(
      'Treasury: Preventing accidental burn',
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
    const { treasury, erc20 } = await loadFixture(deploy);

    // Should prevent burning
    await expect(
      treasury.transferERC20(erc20.address, ethers.constants.AddressZero, 1000),
    ).to.be.revertedWith('Treasury: Preventing accidental burn');

    // Transfer should adjust balances
    await expect(
      treasury.transferERC20(erc20.address, (await ethers.getSigners())[0].address, 1000),
    ).to.changeTokenBalances(
      erc20,
      [treasury.address, (await ethers.getSigners())[0].address],
      [-1000, 1000],
    );
  });
});
