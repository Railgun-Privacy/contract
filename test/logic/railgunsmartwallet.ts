import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  loadFixture,
  setBalance,
  impersonateAccount,
} from '@nomicfoundation/hardhat-network-helpers';

import { MerkleTree } from '../../helpers/logic/merkletree';
import { Wallet } from '../../helpers/logic/wallet';
import { loadAllArtifacts } from '../../helpers/logic/artifacts';
import { randomBytes } from '../../helpers/global/crypto';
import { Note, TokenData, TokenType } from '../../helpers/logic/note';
import { dummyTransact, getFee, UnshieldType } from '../../helpers/logic/transaction';

describe('Logic/RailgunSmartWallet', () => {
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
      40,
      30,
      25,
      adminAccount.address,
    );

    // Get alternative signers
    const railgunSmartWalletSnarkBypass = railgunSmartWallet.connect(snarkBypassSigner);
    const railgunSmartWalletAdmin = railgunSmartWallet.connect(adminAccount);

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

    // Create merkle tree and wallets
    const merkletree = await MerkleTree.createTree();
    const wallet1 = new Wallet(randomBytes(32), randomBytes(32));
    const wallet2 = new Wallet(randomBytes(32), randomBytes(32));

    return {
      primaryAccount,
      treasuryAccount,
      adminAccount,
      railgunSmartWallet,
      railgunSmartWalletSnarkBypass,
      railgunSmartWalletAdmin,
      testERC20,
      testERC721,
      merkletree,
      wallet1,
      wallet2,
    };
  }

  it('Should deposit, transfer, and withdraw ERC20', async () => {
    const {
      treasuryAccount,
      railgunSmartWalletSnarkBypass,
      testERC20,
      merkletree,
      wallet1,
      wallet2,
    } = await loadFixture(deploy);

    // Shield a note
    const tokenData: TokenData = {
      tokenType: TokenType.ERC20,
      tokenAddress: testERC20.address,
      tokenSubID: 0n,
    };

    wallet1.tokens.push(tokenData);
    wallet2.tokens.push(tokenData);

    const shieldNotes = [
      new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
      new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
      new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
      new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
      new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
    ];

    const shieldTransaction = await railgunSmartWalletSnarkBypass.shield(
      [...(await Promise.all(shieldNotes.map((note) => note.getCommitmentPreimage())))],
      [...(await Promise.all(shieldNotes.map((note) => note.encryptForShield())))],
    );

    const totalShielded = shieldNotes
      .map((note) => note.value)
      .reduce((left, right) => left + right);

    // Calculate fee
    const shieldFee = getFee(
      totalShielded,
      true,
      (await railgunSmartWalletSnarkBypass.shieldFee()).toBigInt(),
    );

    // Check tokens amounts moved correctly
    await expect(shieldTransaction).to.changeTokenBalances(
      testERC20,
      [
        await railgunSmartWalletSnarkBypass.signer.getAddress(),
        railgunSmartWalletSnarkBypass.address,
        treasuryAccount.address,
      ],
      [-totalShielded, shieldFee.base, shieldFee.fee],
    );

    // Scan transaction
    await merkletree.scanTX(shieldTransaction, railgunSmartWalletSnarkBypass);
    await wallet1.scanTX(shieldTransaction, railgunSmartWalletSnarkBypass);
    await wallet2.scanTX(shieldTransaction, railgunSmartWalletSnarkBypass);

    // Check balances
    expect(await wallet1.getBalance(merkletree, tokenData)).to.equal(shieldFee.base);
    expect(await wallet2.getBalance(merkletree, tokenData)).to.equal(0);

    // Transfer tokens between shielded balances
    const transferNotes = await wallet1.getTestTransactionInputs(
      merkletree,
      2,
      3,
      false,
      tokenData,
      wallet2.spendingKey,
      wallet2.viewingKey,
    );

    const transferTransaction = await railgunSmartWalletSnarkBypass.transact([
      await dummyTransact(
        merkletree,
        0n,
        UnshieldType.NONE,
        ethers.constants.AddressZero,
        new Uint8Array(32),
        transferNotes.inputs,
        transferNotes.outputs,
      ),
    ]);

    // Calculate total transferred
    const totalTransferred = transferNotes.outputs
      .map((note) => note.value)
      .reduce((left, right) => left + right);

    // Check balances
    expect(await wallet1.getBalance(merkletree, tokenData)).to.equal(shieldFee.base - totalTransferred);
    expect(await wallet2.getBalance(merkletree, tokenData)).to.equal(totalTransferred);    

    // Scan transaction
    await merkletree.scanTX(transferTransaction, railgunSmartWalletSnarkBypass);
    await wallet1.scanTX(transferTransaction, railgunSmartWalletSnarkBypass);
    await wallet2.scanTX(transferTransaction, railgunSmartWalletSnarkBypass);
  });
});
