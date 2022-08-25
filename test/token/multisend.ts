import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

describe('Token/Multisend', function () {
  async function deploy() {
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const Multisend = await ethers.getContractFactory('Multisend');

    // Deploy token
    const testERC20 = await TestERC20.deploy();

    // Deploy multisend
    const multisend = await Multisend.deploy();

    // Approve entire balance
    await testERC20.approve(multisend.address, await testERC20.balanceOf((await ethers.getSigners())[0].address));

    return { testERC20, multisend };
  }

  it('Should multisend', async function () {
    const { testERC20, multisend } = await loadFixture(deploy);

    // Setup transfer object
    const transfer = {
      to: (await ethers.getSigners())[1].address,
      amount: 100n,
    };
    const sendTokens = new Array(200).fill(transfer);

    // Sum total transferred
    const sum = sendTokens.map((tx) => tx.amount).reduce((left, right) => left + right);

    // Send transfer
    await multisend.multisend(testERC20.address, sendTokens);

    // Check correct amount of tokens transferred
    expect(await testERC20.balanceOf((await ethers.getSigners())[1].address)).to.equal(sum);
  });
});
