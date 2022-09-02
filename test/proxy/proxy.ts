import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

describe('Proxy/Proxy', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    const Proxy = await ethers.getContractFactory('PausableUpgradableProxy');
    const TargetA = await ethers.getContractFactory('ProxyTargetStubA');
    const TargetB = await ethers.getContractFactory('ProxyTargetStubB');

    // Deploy proxy with signer 1 as admin
    const proxy = await Proxy.deploy((await ethers.getSigners())[1].address);

    // Get admin interface by connecting to signer 1
    const proxy2 = proxy.connect((await ethers.getSigners())[1]);

    // Deploy targets
    const targetA = await TargetA.deploy();
    const targetB = await TargetB.deploy();

    // Get target interface
    const target = targetA.attach(proxy.address);

    return {
      proxy,
      proxy2,
      target,
      targetA,
      targetB,
    };
  }

  it('Should upgrade and unpause', async () => {
    const { proxy2, target, targetA } = await loadFixture(deploy);

    // Deployment should begin paused
    await expect(target.identify()).to.be.revertedWith('Proxy: Contract is paused');

    // Unpause
    await expect(proxy2.unpause()).to.emit(proxy2, 'ProxyUnpause');

    // Multiple calls should noop
    await expect(proxy2.unpause()).to.not.emit(proxy2, 'ProxyUnpause');

    // Should throw if implementation contract doesn't exist
    await expect(target.identify()).to.be.revertedWith("Proxy: Implementation doesn't exist");
    await expect(
      (await ethers.getSigners())[0].sendTransaction({ to: target.address, value: 100 }),
    ).to.be.revertedWith("Proxy: Implementation doesn't exist");

    // Upgrade
    await expect(proxy2.upgrade(targetA.address))
      .to.emit(proxy2, 'ProxyUpgrade')
      .withArgs(ethers.constants.AddressZero, targetA.address);

    // Multiple calls should noop
    await expect(proxy2.upgrade(targetA.address)).to.not.emit(proxy2, 'ProxyUpgrade');

    // Target functions should go through after unpause
    expect(await target.identify()).to.equal('A');
    await expect((await ethers.getSigners())[0].sendTransaction({ to: target.address, value: 100 }))
      .to.be.fulfilled;

    // Target functions with same name as signature should go through if called by non-admin
    expect(await target.transferOwnership(ethers.constants.AddressZero)).to.equal('Implementation');
    expect(await target.upgrade(ethers.constants.AddressZero)).to.equal('Implementation');
    expect(await target.pause()).to.equal('Implementation');
    expect(await target.unpause()).to.equal('Implementation');

    // Pause
    await expect(proxy2.pause()).to.emit(proxy2, 'ProxyPause');

    // Multiple calls should noop
    await expect(proxy2.pause()).to.not.emit(proxy2, 'ProxyPause');

    // Implementation functions should be inaccessible
    await expect(target.identify()).to.be.revertedWith('Proxy: Contract is paused');
  });

  it('Should transfer ownership', async () => {
    const { proxy, proxy2 } = await loadFixture(deploy);

    // Non-owner shouldn't be able to access functions
    await expect(proxy.unpause()).to.be.revertedWith('Proxy: Contract is paused');
    await expect(proxy2.unpause()).to.be.fulfilled;
    await expect(proxy2.pause()).to.be.fulfilled;

    // Transfer ownership to 0 address should be prevented
    await expect(proxy2.transferOwnership(ethers.constants.AddressZero)).to.be.revertedWith(
      'Proxy: Preventing potential accidental burn',
    );

    // Transfer ownership
    await expect(proxy2.transferOwnership((await ethers.getSigners())[0].address))
      .to.emit(proxy2, 'ProxyOwnershipTransfer')
      .withArgs((await ethers.getSigners())[1].address, (await ethers.getSigners())[0].address);

    // Non-owner shouldn't be able to access functions
    await expect(proxy2.unpause()).to.be.revertedWith('Proxy: Contract is paused');
    await expect(proxy.unpause()).to.be.fulfilled;
    await expect(proxy.pause()).to.be.fulfilled;
  });
});
