/* eslint-disable func-names */
/* global describe it beforeEach */
const hre = require('hardhat');
const { ethers } = require('hardhat');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

const babyjubjub = require('../../helpers/babyjubjub');
const Note = require('../../helpers/note');

let railgunLogic;
let primaryAccount;
let treasuryAccount;

describe('Logic/RailgunLogic', () => {
  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    [primaryAccount, treasuryAccount] = accounts;

    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const PoseidonT4 = await ethers.getContractFactory('PoseidonT4');
    const poseidonT3 = await PoseidonT3.deploy();
    const poseidonT4 = await PoseidonT4.deploy();

    const RailgunLogic = await ethers.getContractFactory('RailgunLogic', {
      libraries: {
        PoseidonT3: poseidonT3.address,
        PoseidonT4: poseidonT4.address,
      },
    });
    railgunLogic = await RailgunLogic.deploy();
    await railgunLogic.initializeRailgunLogic(
      treasuryAccount.address,
      25n,
      25n,
      25n,
      primaryAccount.address,
    );
  });

  it('Should hash note preimages', async () => {
    let loops = 10n;

    if (process.env.LONG_TESTS) {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 1000n;
    }

    for (let i = 0n; i < loops; i += 1n) {
      const privateKey = babyjubjub.genRandomPrivateKey();
      const nullifyingKey = babyjubjub.genRandomPrivateKey();

      const note = new Note(
        privateKey,
        nullifyingKey,
        i,
        BigInt(ethers.utils.keccak256(ethers.BigNumber.from(i).toHexString())),
        BigInt(ethers.utils.keccak256(ethers.BigNumber.from(i * loops).toHexString()).slice(0, 42)),
      );

      // eslint-disable-next-line no-await-in-loop
      const contractHash = await railgunLogic.hashCommitment({
        npk: note.notePublicKey,
        token: {
          tokenType: 0,
          tokenAddress: ethers.BigNumber.from(note.token).toHexString(),
          tokenSubID: 0,
        },
        value: note.value,
      });

      expect(contractHash).to.equal(note.hash);
    }
  });
});
