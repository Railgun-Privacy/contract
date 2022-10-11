import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  loadFixture,
  setBalance,
  impersonateAccount,
} from '@nomicfoundation/hardhat-network-helpers';

import { edBabyJubJub } from '../../../helpers/global/crypto';
import { bigIntToArray } from '../../../helpers/global/bytes';

import { MerkleTree } from '../../../helpers/logic/merkletree';
import { Wallet } from '../../../helpers/logic/wallet';
import { Note, TokenType } from '../../../helpers/logic/note';
import {
  commitmentPreimageMatcher,
  encryptedRandomMatcher,
} from '../../../helpers/logic/transaction';

describe('Logic/RailgunLogic/ERC20', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    // Set balance and impersonate dummy signer
    await setBalance('0x000000000000000000000000000000000000dEaD', '0x56BC75E2D63100000');
    await impersonateAccount('0x000000000000000000000000000000000000dEaD');
    const snarkBypassSigner = await ethers.getSigner('0x000000000000000000000000000000000000dEaD');

    // Get primary and treasury accounts
    const [primaryAccount, treasuryAccount, adminAccount] = await ethers.getSigners();

    // Deploy poseidon libraries
    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const PoseidonT4 = await ethers.getContractFactory('PoseidonT4');
    const poseidonT3 = await PoseidonT3.deploy();
    const poseidonT4 = await PoseidonT4.deploy();

    // Deploy and initialize RailgunLogic
    const RailgunLogic = await ethers.getContractFactory('RailgunLogicStub', {
      libraries: {
        PoseidonT3: poseidonT3.address,
        PoseidonT4: poseidonT4.address,
      },
    });
    const railgunLogic = await RailgunLogic.deploy();
    await railgunLogic.initializeRailgunLogic(
      treasuryAccount.address,
      25n,
      25n,
      25n,
      adminAccount.address,
    );
    const railgunLogicSnarkBypass = railgunLogic.connect(snarkBypassSigner);
    const railgunLogicAdmin = railgunLogic.connect(adminAccount);

    // Deploy test ERC20 and approve for deposit
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const testERC20 = await TestERC20.deploy();
    const testERC20BypassSigner = testERC20.connect(snarkBypassSigner);
    await testERC20.transfer('0x000000000000000000000000000000000000dEaD', 2n ** 256n / 2n);
    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);
    await testERC20BypassSigner.approve(railgunLogic.address, 2n ** 256n - 1n);

    return {
      snarkBypassSigner,
      primaryAccount,
      treasuryAccount,
      adminAccount,
      railgunLogic,
      railgunLogicSnarkBypass,
      railgunLogicAdmin,
      testERC20,
      testERC20BypassSigner,
    };
  }

  it('Should deposit ERC20', async function () {
    const { railgunLogic, testERC20 } = await loadFixture(deploy);

    const loops = 5;

    // Create random keys
    const viewingKey = edBabyJubJub.genRandomPrivateKey();
    const spendingKey = edBabyJubJub.genRandomPrivateKey();

    // Create merkle tree and wallet
    const merkletree = await MerkleTree.createTree();
    const wallet = new Wallet(spendingKey, viewingKey);

    // Retrieve deposit fee
    const depositFeeBP = (await railgunLogic.depositFee()).toBigInt();

    // Loop through number of deposits in batch
    for (let i = 1; i < loops; i += 1) {
      // Create deposit notes
      const notes = new Array(i).fill(1).map(
        (x, index) =>
          new Note(
            spendingKey,
            viewingKey,
            BigInt(i) * BigInt(index + 1),
            bigIntToArray(BigInt(i), 16),
            {
              tokenType: TokenType.ERC20,
              tokenAddress: testERC20.address,
              tokenSubID: 0n,
            },
            '',
          ),
      );

      // Fetch encrypted randoms
      const encryptedRandoms = notes.map((note) => note.encryptedRandom);

      // Fetch commitment preimages
      const preimages = await Promise.all(notes.map((note) => note.getCommitmentPreimage()));

      // Get transaction
      const tx = await railgunLogic.generateDeposit(preimages, encryptedRandoms);

      // Check contract ensures random and preimages length matches
      await expect(
        railgunLogic.generateDeposit(preimages, [...encryptedRandoms, ...encryptedRandoms]),
      ).to.be.revertedWith("RailgunLogic: notes and encrypted random length doesn't match");

      // Check event is emitted
      // Start position should be nth triangular number of i - 1
      await expect(tx)
        .to.emit(railgunLogic, 'GeneratedCommitmentBatch')
        .withArgs(
          0,
          ((i - 1) / 2) * i,
          commitmentPreimageMatcher(preimages),
          encryptedRandomMatcher(encryptedRandoms),
        );
    }

    // Generate note with 0 value
    const zeroNote = new Note(
      spendingKey,
      viewingKey,
      0n,
      bigIntToArray(1n, 16),
      {
        tokenType: TokenType.ERC20,
        tokenAddress: testERC20.address,
        tokenSubID: 0n,
      },
      '',
    );

    // Check contract throws on zero value notes
    await expect(
      railgunLogic.generateDeposit(
        [await zeroNote.getCommitmentPreimage()],
        [zeroNote.encryptedRandom],
      ),
    ).to.be.revertedWith('RailgunLogic: Cannot deposit 0 tokens');
  });

  it("Shouldn't deposit blocklisted ERC20", async function () {
    const { railgunLogic, railgunLogicAdmin, testERC20 } = await loadFixture(deploy);

    // Create random keys
    const viewingKey = edBabyJubJub.genRandomPrivateKey();
    const spendingKey = edBabyJubJub.genRandomPrivateKey();

    // Generate note
    const note = new Note(
      spendingKey,
      viewingKey,
      100n,
      bigIntToArray(1n, 16),
      {
        tokenType: TokenType.ERC20,
        tokenAddress: testERC20.address,
        tokenSubID: 0n,
      },
      '',
    );

    // Block token
    await railgunLogicAdmin.addToBlocklist([testERC20.address]);

    // Check contract throws
    await expect(
      railgunLogic.generateDeposit([await note.getCommitmentPreimage()], [note.encryptedRandom]),
    ).to.be.revertedWith('RailgunLogic: Token is blocklisted');
  });

  it('Should reject npk out of range', async function () {
    const { railgunLogic, testERC20 } = await loadFixture(deploy);

    // Create random keys
    const viewingKey = edBabyJubJub.genRandomPrivateKey();
    const spendingKey = edBabyJubJub.genRandomPrivateKey();

    // Generate note
    const note = new Note(
      spendingKey,
      viewingKey,
      100n,
      bigIntToArray(1n, 16),
      {
        tokenType: TokenType.ERC20,
        tokenAddress: testERC20.address,
        tokenSubID: 0n,
      },
      '',
    );

    // Get preimage
    const preimage = await note.getCommitmentPreimage();

    // Set preimage npm to value out of rance
    preimage.npk = bigIntToArray(2n ** 256n - 1n, 32);

    // Check contract throws
    await expect(
      railgunLogic.generateDeposit([preimage], [note.encryptedRandom]),
    ).to.be.revertedWith('RailgunLogic: npk out of range');
  });
});
