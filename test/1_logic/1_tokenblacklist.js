/* global describe it beforeEach ethers */
const { expect } = require('chai');

let blacklist;

describe('Logic/Blacklist', () => {
  beforeEach(async () => {
    const Blacklist = await ethers.getContractFactory('TokenBlacklistStub');
    blacklist = await Blacklist.deploy();
  });

  it('Should initialize blacklist with passed values', async () => {
    await blacklist.initializeTokenBlacklistStub([
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ]);

    expect(await blacklist.tokenBlacklist('0x0000000000000000000000000000000000000000'))
      .to.equal(true);
    expect(await blacklist.tokenBlacklist('0x0000000000000000000000000000000000000001'))
      .to.equal(true);
    expect(await blacklist.tokenBlacklist('0x0000000000000000000000000000000000000002'))
      .to.equal(true);
  });

  it('Should add address to blacklist', async () => {
    await blacklist.initializeTokenBlacklistStub([
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ]);
    expect(await blacklist.tokenBlacklist('0x0000000000000000000000000000000000000003'))
      .to.equal(false);

    await blacklist.addToBlacklist(['0x0000000000000000000000000000000000000003']);

    expect(await blacklist.tokenBlacklist('0x0000000000000000000000000000000000000003'))
      .to.equal(true);
  });

  it('Should remove address from blacklist', async () => {
    await blacklist.initializeTokenBlacklistStub([
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ]);
    expect(await blacklist.tokenBlacklist('0x0000000000000000000000000000000000000002'))
      .to.equal(true);

    await blacklist.removeFromBlacklist(['0x0000000000000000000000000000000000000002']);

    expect(await blacklist.tokenBlacklist('0x0000000000000000000000000000000000000002'))
      .to.equal(false);
  });
});
