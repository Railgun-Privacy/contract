/* global hre describe it beforeEach ethers */
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

const artifacts = require('../../helpers/snarkKeys');
const transaction = require('../../helpers/transaction');

let verifier;
let snarkBypassSigner;
let verifierBypassSigner;

describe('Logic/Verifier', () => {
  beforeEach(async () => {
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: ['0x0000000000000000000000000000000000000000'],
    });
    snarkBypassSigner = await ethers.getSigner('0x0000000000000000000000000000000000000000');

    const VerifierStub = await ethers.getContractFactory('VerifierStub');
    verifier = await VerifierStub.deploy();
    verifierBypassSigner = verifier.connect(snarkBypassSigner);
  });

  it('Should set verifying key', async () => {
    const { solidityVkey } = artifacts.getKeys(1, 2);

    const setKey = await (await verifier.setVerificationKey(1, 2, solidityVkey)).wait();

    expect(setKey.events[0].event).to.equal('VerifyingKeySet');
    expect(setKey.events[0].args.nullifiers).to.equal(1n);
    expect(setKey.events[0].args.commitments).to.equal(2n);
    expect(
      setKey.events[0].args.verifyingKey.artifactsIPFSHash,
    ).to.equal(solidityVkey.artifactsIPFSHash);
    expect(setKey.events[0].args.verifyingKey.alpha1.x).to.equal(solidityVkey.alpha1.x);
    expect(setKey.events[0].args.verifyingKey.beta2.x[0]).to.equal(solidityVkey.beta2.x[0]);
    expect(setKey.events[0].args.verifyingKey.delta2.x[0]).to.equal(solidityVkey.delta2.x[0]);
    expect(setKey.events[0].args.verifyingKey.gamma2.x[0]).to.equal(solidityVkey.gamma2.x[0]);
    expect(setKey.events[0].args.verifyingKey.ic[0].x).to.equal(solidityVkey.ic[0].x);

    const key = await verifier.getVerificationKey(1n, 2n);

    expect(key.artifactsIPFSHash).to.equal(solidityVkey.artifactsIPFSHash);
    expect(key.alpha1.x).to.equal(solidityVkey.alpha1.x);
    expect(key.beta2.x[0]).to.equal(solidityVkey.beta2.x[0]);
    expect(key.delta2.x[0]).to.equal(solidityVkey.delta2.x[0]);
    expect(key.gamma2.x[0]).to.equal(solidityVkey.gamma2.x[0]);
    expect(key.ic[0].x).to.equal(solidityVkey.ic[0].x);
  });

  it('Should verify proof', async () => {
    const tx = transaction.transact();
  });
});
