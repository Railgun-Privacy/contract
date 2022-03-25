/* global describe it beforeEach ethers */
const { expect } = require('chai');
const { poseidon } = require('circomlib');

let commitmentsStub;

describe('Logic/Snark', () => {
  beforeEach(async () => {
    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const poseidonT3 = await PoseidonT3.deploy();

    const CommitmentsStub = await ethers.getContractFactory('CommitmentsStub', {
      libraries: {
        PoseidonT3: poseidonT3.address,
      },
    });
    commitmentsStub = await CommitmentsStub.deploy();
  });

  it('Should hash left/right pairs', async () => {
    for (let i = 0n; i < 10n; i += 1n) {
      const left = poseidon([i]);
      const right = poseidon([i, 10000n]);
      const result = poseidon([left, right]);

      // eslint-disable-next-line no-await-in-loop
      await expect(await commitmentsStub.hashLeftRight(left, right)).to.equal(result);
    }
  });
});
