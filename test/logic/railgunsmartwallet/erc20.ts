import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  loadFixture,
  setBalance,
  impersonateAccount,
} from '@nomicfoundation/hardhat-network-helpers';

import { edBabyJubJub } from '../../../helpers/global/crypto';
import { bigIntToArray } from '../../../helpers/global/bytes';

import { Note, TokenType } from '../../../helpers/logic/note';
import {
  commitmentPreimageMatcher,
  shieldCiphertextMatcher,
  getFee,
} from '../../../helpers/logic/transaction';
import { loadAllArtifacts } from '../../../helpers/logic/artifacts';
import { randomBytes } from 'crypto';

describe('Logic/RailgunSmartWallet/ERC20', () => {
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
    const [primaryAccount, secondaryAccount, treasuryAccount, adminAccount] =
      await ethers.getSigners();

    // Deploy poseidon libraries
    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const PoseidonT4 = await ethers.getContractFactory('PoseidonT4');
    const poseidonT3 = await PoseidonT3.deploy();
    const poseidonT4 = await PoseidonT4.deploy();

    // Deploy and initialize RailgunSmartWallet
    const RailgunSmartWallet = await ethers.getContractFactory('RailgunSmartWallet', {
      libraries: {
        PoseidonT3: poseidonT3.address,
        PoseidonT4: poseidonT4.address,
      },
    });
    const railgunSmartWallet = await RailgunSmartWallet.deploy();
    await railgunSmartWallet.initializeRailgunLogic(
      treasuryAccount.address,
      25n,
      25n,
      25n,
      adminAccount.address,
    );
    const railgunSmartWalletSnarkBypass = railgunSmartWallet.connect(snarkBypassSigner);
    const railgunSmartWalletAdmin = railgunSmartWallet.connect(adminAccount);

    // Set verifier keys
    await loadAllArtifacts(railgunSmartWalletAdmin);

    // Deploy test ERC20 and approve for shield
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const testERC20 = await TestERC20.deploy();
    const testERC20BypassSigner = testERC20.connect(snarkBypassSigner);
    await testERC20.transfer('0x000000000000000000000000000000000000dEaD', 2n ** 256n / 2n);
    await testERC20.approve(railgunSmartWallet.address, 2n ** 256n - 1n);
    await testERC20BypassSigner.approve(railgunSmartWallet.address, 2n ** 256n - 1n);

    return {
      snarkBypassSigner,
      primaryAccount,
      secondaryAccount,
      treasuryAccount,
      adminAccount,
      railgunSmartWallet,
      railgunSmartWalletSnarkBypass,
      railgunSmartWalletAdmin,
      testERC20,
      testERC20BypassSigner,
    };
  }

  it('Should shield ERC20', async function () {
    const { railgunSmartWallet, primaryAccount, treasuryAccount, testERC20 } = await loadFixture(
      deploy,
    );

    const loops = 5;

    // Create random keys
    const viewingKey = edBabyJubJub.genRandomPrivateKey();
    const spendingKey = edBabyJubJub.genRandomPrivateKey();

    // Retrieve shield fee
    const shieldFeeBP = (await railgunSmartWallet.shieldFee()).toBigInt();

    // Loop through number of shields in batch
    for (let i = 1; i < loops; i += 1) {
      // Create shield notes
      const notes = new Array(i).fill(1).map(
        (x, index) =>
          new Note(
            spendingKey,
            viewingKey,
            BigInt(i) * BigInt(index + 1) * 10n ** 18n,
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
      const shieldCiphertext = await Promise.all(notes.map((note) => note.encryptForShield()));

      // Fetch commitment preimages
      const preimages = await Promise.all(notes.map((note) => note.getCommitmentPreimage()));

      // Get transaction
      const tx = await railgunSmartWallet.shield(preimages, shieldCiphertext);

      // Check contract ensures random and preimages length matches
      await expect(
        railgunSmartWallet.shield(preimages, [...shieldCiphertext, ...shieldCiphertext]),
      ).to.be.revertedWith("RailgunSmartWallet: notes and shield ciphertext length doesn't match");

      // Calculate total value of shields
      const total = notes.map((note) => note.value).reduce((left, right) => left + right);

      // Get fees
      const { base, fee } = getFee(total, true, shieldFeeBP);

      // Get commitment preimages adjusted by shield fee
      const adjustedPreimages = preimages.map((preimage) => {
        // Get base
        const noteBase = getFee(preimage.value, true, shieldFeeBP).base;

        return {
          npk: preimage.npk,
          token: preimage.token,
          value: noteBase,
        };
      });

      // Check event is emitted and tokens were moved correctly
      // Start position should be nth triangular number of i - 1
      await expect(tx)
        .to.emit(railgunSmartWallet, 'Shield')
        .withArgs(
          0,
          ((i - 1) / 2) * i,
          commitmentPreimageMatcher(adjustedPreimages),
          shieldCiphertextMatcher(shieldCiphertext),
        );
      await expect(tx).to.changeTokenBalances(
        testERC20,
        [primaryAccount.address, railgunSmartWallet.address, treasuryAccount.address],
        [-total, base, fee],
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
      railgunSmartWallet.shield(
        [await zeroNote.getCommitmentPreimage()],
        [await zeroNote.encryptForShield()],
      ),
    ).to.be.revertedWith('RailgunSmartWallet: Cannot shield 0 tokens');
  });

  it("Shouldn't shield blocklisted ERC20", async function () {
    const { railgunSmartWallet, railgunSmartWalletAdmin, testERC20 } = await loadFixture(deploy);

    // Create random keys
    const viewingKey = edBabyJubJub.genRandomPrivateKey();
    const spendingKey = edBabyJubJub.genRandomPrivateKey();

    // Generate note
    const note = new Note(
      spendingKey,
      viewingKey,
      100n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC20,
        tokenAddress: testERC20.address,
        tokenSubID: 0n,
      },
      '',
    );

    // Block token
    await railgunSmartWalletAdmin.addToBlocklist([testERC20.address]);

    // Check contract throws
    await expect(
      railgunSmartWallet.shield(
        [await note.getCommitmentPreimage()],
        [await note.encryptForShield()],
      ),
    ).to.be.revertedWith('RailgunSmartWallet: Token is blocklisted');
  });
});
