/* global describe it beforeEach ethers */
const { expect } = require('chai');

let whitelist;

describe('Logic/Whitelist', () => {
  beforeEach(async () => {
    const Whitelist = await ethers.getContractFactory('TokenWhitelistStub');
    whitelist = await Whitelist.deploy();
  });

  it('Should initialize whitelist with passed values', async () => {
    await whitelist.initializeTokenWhitelistStub([
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ]);

    expect(await whitelist.tokenWhitelist('0x0000000000000000000000000000000000000000'))
      .to.equal(true);
    expect(await whitelist.tokenWhitelist('0x0000000000000000000000000000000000000001'))
      .to.equal(true);
    expect(await whitelist.tokenWhitelist('0x0000000000000000000000000000000000000002'))
      .to.equal(true);
  });

  it('Should add address to whitelist', async () => {
    await whitelist.initializeTokenWhitelistStub([
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ]);
    expect(await whitelist.tokenWhitelist('0x0000000000000000000000000000000000000003'))
      .to.equal(false);

    await whitelist.addToWhitelist(['0x0000000000000000000000000000000000000003']);

    expect(await whitelist.tokenWhitelist('0x0000000000000000000000000000000000000003'))
      .to.equal(true);
  });

  it('Should remove address from whitelist', async () => {
    await whitelist.initializeTokenWhitelistStub([
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ]);
    expect(await whitelist.tokenWhitelist('0x0000000000000000000000000000000000000002'))
      .to.equal(true);

    await whitelist.removeFromWhitelist(['0x0000000000000000000000000000000000000002']);

    expect(await whitelist.tokenWhitelist('0x0000000000000000000000000000000000000002'))
      .to.equal(false);
  });
});
