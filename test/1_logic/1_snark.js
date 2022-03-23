/* global describe it beforeEach ethers */
const { expect } = require('chai');

let snarkStub;

describe('Logic/Snark', () => {
  beforeEach(async () => {
    const SnarkStub = await ethers.getContractFactory('SnarkStub');
    snarkStub = await SnarkStub.deploy();
  });

  it('Should reject invalid proofs', async () => {
    expect(await snarkStub.verify(
      {
        artifactsIPFSHash: '',
        alpha1: { x: 0n, y: 0n },
        beta2: { x: [0n, 0n], y: [0n, 0n] },
        gamma2: { x: [0n, 0n], y: [0n, 0n] },
        delta2: { x: [0n, 0n], y: [0n, 0n] },
        ic: [
          { x: 0n, y: 0n },
          { x: 0n, y: 0n },
        ],
      },
      {
        a: { x: 0n, y: 0n },
        b: { x: [0n, 0n], y: [0n, 0n] },
        c: { x: 0n, y: 0n },
      },
      [1n],
    )).to.equal(false);
  });

  it('Should accept valid proofs', async () => {
    expect(await snarkStub.verify(
      {
        artifactsIPFSHash: '',
        alpha1: { x: 0n, y: 0n },
        beta2: { x: [0n, 0n], y: [0n, 0n] },
        gamma2: { x: [0n, 0n], y: [0n, 0n] },
        delta2: { x: [0n, 0n], y: [0n, 0n] },
        ic: [
          { x: 0n, y: 0n },
          { x: 0n, y: 0n },
        ],
      },
      {
        a: { x: 0n, y: 0n },
        b: { x: [0n, 0n], y: [0n, 0n] },
        c: { x: 0n, y: 0n },
      },
      [1n],
    )).to.equal(false);
  });
});
