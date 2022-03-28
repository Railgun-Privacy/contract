/* global describe it beforeEach ethers */
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

let proxy;
let proxyAdmin;

describe('Proxy/ProxyAdmin', () => {
  beforeEach(async () => {
    const Proxy = await ethers.getContractFactory('PausableUpgradableProxy');
    const ProxyAdmin = await ethers.getContractFactory('ProxyAdmin');

    proxyAdmin = await ProxyAdmin.deploy(
      (await ethers.getSigners())[0].address,
    );

    proxy = await Proxy.deploy(
      proxyAdmin.address,
    );
  });

  it('Should upgrade and unpause', async () => {
    const Target = await ethers.getContractFactory('ProxyTargetStubA');

    await proxyAdmin.upgrade(proxy.address, (await Target.deploy()).address);
    await proxyAdmin.unpause(proxy.address);

    const target = Target.attach(proxy.address);

    expect(await target.testFunction()).to.equal('A');
  });

  it('Should unpause and pause again', async () => {
    const Target = await ethers.getContractFactory('ProxyTargetStubA');

    await proxyAdmin.upgrade(proxy.address, (await Target.deploy()).address);
    await proxyAdmin.unpause(proxy.address);

    const target = Target.attach(proxy.address);

    expect(await target.testFunction()).to.equal('A');

    await proxyAdmin.pause(proxy.address);

    await expect(target.testFunction()).to.eventually.be.rejectedWith('Proxy: Contract is paused');
  });

  it('Should upgrade unpause and upgrade again', async () => {
    const TargetA = await ethers.getContractFactory('ProxyTargetStubA');
    const TargetB = await ethers.getContractFactory('ProxyTargetStubB');

    await proxyAdmin.upgrade(proxy.address, (await TargetA.deploy()).address);
    await proxyAdmin.unpause(proxy.address);

    const target = TargetA.attach(proxy.address);

    expect(await target.testFunction()).to.equal('A');

    await proxyAdmin.upgrade(proxy.address, (await TargetB.deploy()).address);

    expect(await target.testFunction()).to.equal('B');
  });
});
