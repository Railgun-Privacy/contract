import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

describe('Proxy/ProxyAdmin', () => {
  async function deploy() {
    const Proxy = await ethers.getContractFactory('PausableUpgradableProxy');
    const ProxyAdmin = await ethers.getContractFactory('ProxyAdmin');
    const TargetA = await ethers.getContractFactory('ProxyTargetStubA');

    // Get admin interface
    const proxyAdmin = await ProxyAdmin.deploy((await ethers.getSigners())[0].address);

    // Deploy proxy
    const proxy = await Proxy.deploy(proxyAdmin.address);

    // Deploy targets
    const targetA = await TargetA.deploy();

    // Get target interface
    const target = targetA.attach(proxy.address);

    return {
      proxy,
      proxyAdmin,
      target,
      targetA,
    };
  }

  it('Should upgrade and unpause', async () => {
    const { proxy, proxyAdmin, target, targetA } = await loadFixture(deploy);

    // Deployment should begin paused
    await expect(target.identify()).to.be.revertedWith('Proxy: Contract is paused');

    // Unpause
    await expect(proxyAdmin.unpause(proxy.address)).to.emit(proxy, 'ProxyUnpause');

    // Upgrade
    await expect(proxyAdmin.upgrade(proxy.address, targetA.address))
      .to.emit(proxy, 'ProxyUpgrade')
      .withArgs(ethers.constants.AddressZero, targetA.address);

    // Pause
    await expect(proxyAdmin.pause(proxy.address)).to.emit(proxy, 'ProxyPause');
  });

  it('Should transfer proxy ownership', async () => {
    const { proxy, proxyAdmin } = await loadFixture(deploy);

    // Transfer ownership
    await expect(
      proxyAdmin.transferProxyOwnership(proxy.address, (await ethers.getSigners())[0].address),
    )
      .to.emit(proxy, 'ProxyOwnershipTransfer')
      .withArgs(proxyAdmin.address, (await ethers.getSigners())[0].address);
  });
});
