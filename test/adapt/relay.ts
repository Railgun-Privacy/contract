import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  loadFixture,
  setBalance,
  impersonateAccount,
} from '@nomicfoundation/hardhat-network-helpers';

import * as weth9artifact from '@ethereum-artifacts/weth9';

import { getAdaptParams } from '../../helpers/adapt/relay';
import { loadAllArtifacts } from '../../helpers/logic/artifacts';
import { dummyTransact, UnshieldType } from '../../helpers/logic/transaction';
import { MerkleTree } from '../../helpers/logic/merkletree';
import { Note, TokenType } from '../../helpers/logic/note';
import { randomBytes } from '../../helpers/global/crypto';
import { arrayToBigInt, arrayToHexString } from '../../helpers/global/bytes';

describe('Adapt/Relay', () => {
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
    const [primaryAccount, treasuryAccount, adminAccount, secondaryAccount] =
      await ethers.getSigners();

    // Deploy poseidon libraries
    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const PoseidonT4 = await ethers.getContractFactory('PoseidonT4');
    const poseidonT3 = await PoseidonT3.deploy();
    const poseidonT4 = await PoseidonT4.deploy();

    // Deploy RailgunSmartWallet
    const RailgunLogic = await ethers.getContractFactory('RailgunSmartWalletStub', {
      libraries: {
        PoseidonT3: poseidonT3.address,
        PoseidonT4: poseidonT4.address,
      },
    });
    const railgunSmartWallet = await RailgunLogic.deploy();

    // Initialize RailgunSmartWallet
    await railgunSmartWallet.initializeRailgunLogic(
      treasuryAccount.address,
      0,
      0,
      0,
      adminAccount.address,
    );

    // Deploy WETH9
    const WETH9 = new ethers.ContractFactory(
      weth9artifact.WETH9.abi,
      weth9artifact.WETH9.bytecode,
      (await ethers.getSigners())[0],
    );
    const weth9 = await WETH9.deploy();

    // Deploy RelayAdapt
    const RelayAdapt = await ethers.getContractFactory('RelayAdapt');
    const relayAdapt = await RelayAdapt.deploy(railgunSmartWallet.address, weth9.address);

    // Get alternative signers
    const railgunSmartWalletSnarkBypass = railgunSmartWallet.connect(snarkBypassSigner);
    const railgunSmartWalletAdmin = railgunSmartWallet.connect(adminAccount);
    const relayAdaptSnarkBypass = relayAdapt.connect(snarkBypassSigner);
    const relayAdaptAdmin = relayAdapt.connect(adminAccount);

    // Load verification keys
    await loadAllArtifacts(railgunSmartWalletAdmin);

    // Deploy test ERC20 and approve for shield
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const testERC20 = await TestERC20.deploy();
    const testERC20BypassSigner = testERC20.connect(snarkBypassSigner);
    await testERC20.mint(primaryAccount.address, 2n ** 128n - 1n);
    await testERC20.mint('0x000000000000000000000000000000000000dEaD', 2n ** 128n - 1n);
    await testERC20.approve(railgunSmartWallet.address, 2n ** 256n - 1n);
    await testERC20BypassSigner.approve(railgunSmartWallet.address, 2n ** 256n - 1n);

    // Deploy test ERC721 and approve for shield
    const TestERC721 = await ethers.getContractFactory('TestERC721');
    const testERC721 = await TestERC721.deploy();
    const testERC721BypassSigner = testERC721.connect(snarkBypassSigner);
    await testERC721.setApprovalForAll(railgunSmartWallet.address, true);
    await testERC721BypassSigner.setApprovalForAll(railgunSmartWallet.address, true);

    return {
      primaryAccount,
      treasuryAccount,
      adminAccount,
      secondaryAccount,
      railgunSmartWallet,
      railgunSmartWalletSnarkBypass,
      railgunSmartWalletAdmin,
      relayAdapt,
      relayAdaptSnarkBypass,
      relayAdaptAdmin,
      testERC20,
      testERC721,
    };
  }

  it('Should calculate adapt parameters', async function () {
    let loops = 5n;

    if (process.env.LONG_TESTS === 'yes') {
      this.timeout(5 * 60 * 60 * 1000);
      loops = 10n;
    }

    const { relayAdapt } = await loadFixture(deploy);

    for (let i = 1; i < loops; i += 1) {
      // Get test transactions
      const tokenData = {
        tokenType: TokenType.ERC20,
        tokenAddress: arrayToHexString(randomBytes(20), true),
        tokenSubID: 0n,
      };

      const merkletree = await MerkleTree.createTree();

      const notesIn = new Array(i)
        .fill(1)
        .map(
          () =>
            new Note(
              randomBytes(32),
              randomBytes(32),
              arrayToBigInt(randomBytes(5)),
              randomBytes(16),
              tokenData,
              '',
            ),
        );

      const notesOut = new Array(i)
        .fill(1)
        .map(
          () =>
            new Note(
              randomBytes(32),
              randomBytes(32),
              arrayToBigInt(randomBytes(5)),
              randomBytes(16),
              tokenData,
              '',
            ),
        );

      await merkletree.insertLeaves(await Promise.all(notesIn.map((note) => note.getHash())), 0);

      const transactions = await Promise.all(
        new Array(i)
          .fill(1)
          .map(() =>
            dummyTransact(
              merkletree,
              arrayToBigInt(randomBytes(5)),
              UnshieldType.NONE,
              relayAdapt.address,
              randomBytes(32),
              notesIn,
              notesOut,
            ),
          ),
      );

      // Get test action data
      const calls = new Array(i).fill(1).map(() => ({
        to: arrayToHexString(randomBytes(20), true),
        data: randomBytes(i * 32),
        value: arrayToBigInt(randomBytes(5)),
      }));

      const actionData = {
        random: randomBytes(31),
        requireSuccess: i % 2 === 1,
        minGasLimit: arrayToBigInt(randomBytes(5)),
        calls,
      };

      // Check contract and js output matches
      expect(await relayAdapt.getAdaptParams(transactions, actionData)).to.equal(
        arrayToHexString(getAdaptParams(transactions, actionData), true),
      );
    }
  });

  it('Should deposit ERC20', async () => {
    const { relayAdapt, railgunSmartWallet, testERC20 } = await loadFixture(deploy);

    // Check shielding specific amounts works

    // Transfer test tokens to relayAdapt
    await testERC20.transfer(relayAdapt.address, 10n ** 18n);

    // Create deposit note
    const depositNote = new Note(
      randomBytes(32),
      randomBytes(32),
      10n ** 18n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC20,
        tokenAddress: testERC20.address,
        tokenSubID: 0n,
      },
      '',
    );

    // Get shield request
    const shieldRequest = await depositNote.encryptForShield();

    // Shield
    const shieldTransaction = await relayAdapt.shield([shieldRequest]);

    // Check tokens moved
    await expect(shieldTransaction).to.changeTokenBalances(testERC20, [
      relayAdapt.address,
      railgunSmartWallet.address,
    ], [
      -(10n ** 18n),
      10n ** 18n,
    ]);

    // Transfer test tokens to relayAdapt
    await testERC20.transfer(relayAdapt.address, 2n * 10n ** 18n);

    // Check shielding entire balance works

    // Create deposit note with 0 value
    const depositNoteAll = new Note(
      randomBytes(32),
      randomBytes(32),
      0n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC20,
        tokenAddress: testERC20.address,
        tokenSubID: 0n,
      },
      '',
    );

    // Get shield request
    const shieldRequestAll = await depositNoteAll.encryptForShield();

    // Shield
    const shieldTransactionAll = await relayAdapt.shield([shieldRequestAll]);

    // Check tokens moved
    await expect(shieldTransactionAll).to.changeTokenBalances(testERC20, [
      relayAdapt.address,
      railgunSmartWallet.address,
    ], [
      -(2n * 10n ** 18n),
      2n * 10n ** 18n,
    ]);
  });

  it('Should no-op if no tokens to shield', async () => {
    const { relayAdapt, railgunSmartWallet, testERC20 } = await loadFixture(deploy);

    // Create deposit note
    const depositNote = new Note(
      randomBytes(32),
      randomBytes(32),
      10n ** 18n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC20,
        tokenAddress: testERC20.address,
        tokenSubID: 0n,
      },
      '',
    );

    // Get shield request
    const shieldRequest = await depositNote.encryptForShield();

    // Get pre-transaction merkle root
    const merkleRootBefore = await railgunSmartWallet.merkleRoot();

    // Shield
    await relayAdapt.shield([shieldRequest, shieldRequest, shieldRequest]);

    // Get post-transaction merkle root
    const merkleRootAfter = await railgunSmartWallet.merkleRoot();

    // No additions to the merkle tree should have been made
    expect(merkleRootBefore).to.equal(merkleRootAfter);
  });
});
