/* global describe it beforeEach */
const { ethers } = require('hardhat');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

let tokenBlacklist;

describe('Logic/TokenBlacklist', () => {
  beforeEach(async () => {
    const TokenBlacklistStub = await ethers.getContractFactory('TokenBlacklistStub');
    tokenBlacklist = await TokenBlacklistStub.deploy();
  });

  it('Should add and remove from blacklist', async () => {
    expect(await tokenBlacklist.tokenBlacklist('0xeb4c2781e4eba804ce9a9803c67d0893436bb27d')).to.equal(false);
    expect(await tokenBlacklist.tokenBlacklist('0x3832d2F059E55934220881F831bE501D180671A7')).to.equal(false);
    expect(await tokenBlacklist.tokenBlacklist('0x459086f2376525bdceba5bdda135e4e9d3fef5bf')).to.equal(false);
    expect(await tokenBlacklist.tokenBlacklist('0x1c5db575e2ff833e46a2e9864c22f4b22e0b37c2')).to.equal(false);

    await tokenBlacklist.addToBlacklist([
      '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d',
      '0x3832d2F059E55934220881F831bE501D180671A7',
      '0x459086f2376525bdceba5bdda135e4e9d3fef5bf',
      '0x1c5db575e2ff833e46a2e9864c22f4b22e0b37c2',
    ]);

    expect(await tokenBlacklist.tokenBlacklist('0xeb4c2781e4eba804ce9a9803c67d0893436bb27d')).to.equal(true);
    expect(await tokenBlacklist.tokenBlacklist('0x3832d2F059E55934220881F831bE501D180671A7')).to.equal(true);
    expect(await tokenBlacklist.tokenBlacklist('0x459086f2376525bdceba5bdda135e4e9d3fef5bf')).to.equal(true);
    expect(await tokenBlacklist.tokenBlacklist('0x1c5db575e2ff833e46a2e9864c22f4b22e0b37c2')).to.equal(true);

    await tokenBlacklist.removeFromBlacklist([
      '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d',
      '0x3832d2F059E55934220881F831bE501D180671A7',
    ]);

    expect(await tokenBlacklist.tokenBlacklist('0xeb4c2781e4eba804ce9a9803c67d0893436bb27d')).to.equal(false);
    expect(await tokenBlacklist.tokenBlacklist('0x3832d2F059E55934220881F831bE501D180671A7')).to.equal(false);
    expect(await tokenBlacklist.tokenBlacklist('0x459086f2376525bdceba5bdda135e4e9d3fef5bf')).to.equal(true);
    expect(await tokenBlacklist.tokenBlacklist('0x1c5db575e2ff833e46a2e9864c22f4b22e0b37c2')).to.equal(true);
  });

  it('Should emit blacklist events', async () => {
    let expected = [];

    expected = [
      '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d',
      '0x3832d2F059E55934220881F831bE501D180671A7',
    ];

    (await (await tokenBlacklist.addToBlacklist([
      '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d',
      '0x3832d2F059E55934220881F831bE501D180671A7',
    ])).wait()).events.forEach((event, index) => {
      expect(event.event).to.equal('AddToBlacklist');
      expect(event.args.token.toLowerCase()).to.equal(expected[index].toLowerCase());
    });

    expected = [
      '0x459086f2376525bdceba5bdda135e4e9d3fef5bf',
      '0x1c5db575e2ff833e46a2e9864c22f4b22e0b37c2',
    ];

    (await (await tokenBlacklist.addToBlacklist([
      '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d',
      '0x3832d2F059E55934220881F831bE501D180671A7',
      '0x459086f2376525bdceba5bdda135e4e9d3fef5bf',
      '0x1c5db575e2ff833e46a2e9864c22f4b22e0b37c2',
    ])).wait()).events.forEach((event, index) => {
      expect(event.event).to.equal('AddToBlacklist');
      expect(event.args.token.toLowerCase()).to.equal(expected[index].toLowerCase());
    });

    expected = [
      '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d',
    ];

    (await (await tokenBlacklist.removeFromBlacklist([
      '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d',
    ])).wait()).events.forEach((event, index) => {
      expect(event.event).to.equal('RemoveFromBlacklist');
      expect(event.args.token.toLowerCase()).to.equal(expected[index].toLowerCase());
    });

    expected = [
      '0x3832d2F059E55934220881F831bE501D180671A7',
      '0x459086f2376525bdceba5bdda135e4e9d3fef5bf',
      '0x1c5db575e2ff833e46a2e9864c22f4b22e0b37c2',
    ];

    (await (await tokenBlacklist.removeFromBlacklist([
      '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d',
      '0x3832d2F059E55934220881F831bE501D180671A7',
      '0x459086f2376525bdceba5bdda135e4e9d3fef5bf',
      '0x1c5db575e2ff833e46a2e9864c22f4b22e0b37c2',
    ])).wait()).events.forEach((event, index) => {
      expect(event.event).to.equal('RemoveFromBlacklist');
      expect(event.args.token.toLowerCase()).to.equal(expected[index].toLowerCase());
    });
  });
});
