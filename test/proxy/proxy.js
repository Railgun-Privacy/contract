/* global describe it beforeEach ethers */
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

let proxy;

describe('Proxy/Proxy', () => {
  beforeEach(async () => {
    const Proxy = await ethers.getContractFactory('PausableUpgradableProxy');
    proxy = await Proxy.deploy(
      (await ethers.getSigners())[1].address,
    );
    proxy = proxy.connect((await ethers.getSigners())[1]);
  });

  it('Should deploy as paused', async () => {
    const Target = await ethers.getContractFactory('ProxyTargetStubA');
    const target = Target.attach(proxy.address);

    await expect(target.testFunction()).to.eventually.be.rejectedWith('Proxy: Contract is paused');
  });

  it('Should upgrade and unpause', async () => {
    const Target = await ethers.getContractFactory('ProxyTargetStubA');

    await proxy.upgrade((await Target.deploy()).address);
    await proxy.unpause();

    const target = Target.attach(proxy.address);

    expect(await target.testFunction()).to.equal('A');
  });

  it('Should unpause and pause again', async () => {
    const Target = await ethers.getContractFactory('ProxyTargetStubA');

    await proxy.upgrade((await Target.deploy()).address);
    await proxy.unpause();

    const target = Target.attach(proxy.address);

    expect(await target.testFunction()).to.equal('A');

    await proxy.pause();

    await expect(target.testFunction()).to.eventually.be.rejectedWith('Proxy: Contract is paused');
  });

  it('Should upgrade unpause and upgrade again', async () => {
    const TargetA = await ethers.getContractFactory('ProxyTargetStubA');
    const TargetB = await ethers.getContractFactory('ProxyTargetStubB');

    await proxy.upgrade((await TargetA.deploy()).address);
    await proxy.unpause();

    const target = TargetA.attach(proxy.address);

    expect(await target.testFunction()).to.equal('A');

    await proxy.upgrade((await TargetB.deploy()).address);

    expect(await target.testFunction()).to.equal('B');
  });
});
