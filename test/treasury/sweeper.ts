import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, setBalance } from '@nomicfoundation/hardhat-network-helpers';

describe('Treasury/Sweeper', function () {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const Sweeper = await ethers.getContractFactory('Sweeper');
    const Proxy = await ethers.getContractFactory('PausableUpgradableProxy');

    const [primary, target, proxyAdmin] = await ethers.getSigners();

    // Deploy sweeper
    let sweeper = await Sweeper.deploy(target.address);

    // Deploy Proxy and set implementation
    let proxy = await Proxy.deploy(proxyAdmin.address);
    proxy = proxy.connect(proxyAdmin);
    await proxy.upgrade(sweeper.address);
    sweeper = sweeper.attach(proxy.address);
    await proxy.unpause();

    // Deploy token
    const testERC20 = await TestERC20.deploy();

    return { testERC20, sweeper, primary, target, proxyAdmin };
  }

  it('Should transfer ETH and ERC20s', async function () {
    const { testERC20, sweeper, target } = await loadFixture(deploy);

    // Mint ERC20
    await testERC20.mint(sweeper.address, 1000);

    // Mint ETH
    await setBalance(sweeper.address, 1000);

    // Transfer ERC20
    await expect(sweeper.transferERC20(testERC20.address)).to.changeTokenBalances(
      testERC20,
      [sweeper.address, target.address],
      [-1000, 1000],
    );

    // Transfer ETH
    await expect(sweeper.transferETH()).to.changeEtherBalances(
      [sweeper.address, target.address],
      [-1000, 1000],
    );
  });

  it('Should revert on failed ETH send', async function () {
    // Deploy reverting contract
    const Target = await ethers.getContractFactory('GovernanceTargetAlphaStub');
    const target = await Target.deploy();

    // Deploy sweeper
    const Sweeper = await ethers.getContractFactory('Sweeper');
    const sweeper = await Sweeper.deploy(target.address);

    // Mint ETH
    await setBalance(sweeper.address, 1000);

    // Transfer ETH should revert
    await expect(sweeper.transferETH()).to.be.revertedWith('ETH transfer failed');
  });
});
