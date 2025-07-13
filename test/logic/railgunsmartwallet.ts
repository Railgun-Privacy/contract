import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  loadFixture,
  setBalance,
  impersonateAccount,
} from '@nomicfoundation/hardhat-network-helpers';

import { MerkleTree } from '../../helpers/logic/merkletree';
import { Wallet } from '../../helpers/logic/wallet';
import { loadArtifacts, listArtifacts } from '../../helpers/logic/artifacts';
import { randomBytes } from '../../helpers/global/crypto';
import { getTokenID, Note, TokenData, TokenType } from '../../helpers/logic/note';
import {
  dummyTransact,
  getFee,
  padWithDummyNotes,
  UnshieldType,
} from '../../helpers/logic/transaction';
import { arrayToHexString } from '../../helpers/global/bytes';

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

    // Get chainID
    const chainID = BigInt((await ethers.provider.send('eth_chainId', [])) as string); // Hex string returned

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
      40,
      30,
      25,
      adminAccount.address,
    );

    // Get alternative signers
    const railgunSmartWalletSnarkBypass = railgunSmartWallet.connect(snarkBypassSigner);
    const railgunSmartWalletAdmin = railgunSmartWallet.connect(adminAccount);

    // Load verification keys
    await loadArtifacts(railgunSmartWalletAdmin, listArtifacts());

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
      chainID,
      primaryAccount,
      treasuryAccount,
      adminAccount,
      secondaryAccount,
      railgunSmartWallet,
      railgunSmartWalletSnarkBypass,
      railgunSmartWalletAdmin,
      testERC20,
      testERC721,
    };
  }

  it('Should shield, transfer, and withdraw ERC20', async () => {
    const { chainID, treasuryAccount, secondaryAccount, railgunSmartWalletSnarkBypass, testERC20 } =
      await loadFixture(deploy);

    // Create merkle tree and wallets
    const merkletree = await MerkleTree.createTree();
    const wallet1 = new Wallet(randomBytes(32), randomBytes(32));
    const wallet2 = new Wallet(randomBytes(32), randomBytes(32));

    // Shield notes
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

    const shieldTransaction = await railgunSmartWalletSnarkBypass.shield([
      ...(await Promise.all(shieldNotes.map((note) => note.encryptForShield()))),
    ]);

    // Check lastEventBlock updated
    expect(await railgunSmartWalletSnarkBypass.lastEventBlock()).to.equal(
      shieldTransaction.blockNumber,
    );

    const totalShielded = shieldNotes
      .map((note) => note.value)
      .reduce((left, right) => left + right);

    // Calculate shield amounts
    const shieldAmounts = getFee(
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
      [-totalShielded, shieldAmounts.base, shieldAmounts.fee],
    );

    // Scan transaction
    await merkletree.scanTX(shieldTransaction, railgunSmartWalletSnarkBypass);
    await wallet1.scanTX(shieldTransaction, railgunSmartWalletSnarkBypass);
    await wallet2.scanTX(shieldTransaction, railgunSmartWalletSnarkBypass);

    // Check balances
    expect(await wallet1.getBalance(merkletree, tokenData)).to.equal(shieldAmounts.base);
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
        chainID,
        ethers.constants.AddressZero,
        new Uint8Array(32),
        transferNotes.inputs,
        transferNotes.outputs,
      ),
    ]);

    // Double spends should not be possible
    await expect(
      railgunSmartWalletSnarkBypass.transact([
        await dummyTransact(
          merkletree,
          0n,
          UnshieldType.NONE,
          chainID,
          ethers.constants.AddressZero,
          new Uint8Array(32),
          transferNotes.inputs,
          transferNotes.outputs,
        ),
      ]),
    ).to.be.revertedWith('RailgunLogic: Note already spent');

    // Check lastEventBlock updated
    expect(await railgunSmartWalletSnarkBypass.lastEventBlock()).to.equal(
      transferTransaction.blockNumber,
    );

    // Calculate total transferred
    const totalTransferred = transferNotes.outputs
      .map((note) => note.value)
      .reduce((left, right) => left + right);

    // Scan transaction
    await merkletree.scanTX(transferTransaction, railgunSmartWalletSnarkBypass);
    await wallet1.scanTX(transferTransaction, railgunSmartWalletSnarkBypass);
    await wallet2.scanTX(transferTransaction, railgunSmartWalletSnarkBypass);

    // Check balances
    expect(await wallet1.getBalance(merkletree, tokenData)).to.equal(
      shieldAmounts.base - totalTransferred,
    );
    expect(await wallet2.getBalance(merkletree, tokenData)).to.equal(totalTransferred);

    // Unshield tokens between shielded balances
    const unshieldNotes = await wallet2.getTestTransactionInputs(
      merkletree,
      2,
      3,
      secondaryAccount.address,
      tokenData,
      wallet2.spendingKey,
      wallet2.viewingKey,
    );

    const unshieldTransaction = await railgunSmartWalletSnarkBypass.transact([
      await dummyTransact(
        merkletree,
        0n,
        UnshieldType.NORMAL,
        chainID,
        ethers.constants.AddressZero,
        new Uint8Array(32),
        unshieldNotes.inputs,
        unshieldNotes.outputs,
      ),
    ]);

    // Check lastEventBlock updated
    expect(await railgunSmartWalletSnarkBypass.lastEventBlock()).to.equal(
      unshieldTransaction.blockNumber,
    );

    // Get total unshielded
    const totalUnshielded = unshieldNotes.outputs[unshieldNotes.outputs.length - 1].value;

    // Calculate unshield amount
    const unshieldAmounts = getFee(
      totalUnshielded,
      true,
      (await railgunSmartWalletSnarkBypass.unshieldFee()).toBigInt(),
    );

    // Check tokens amounts moved correctly
    await expect(unshieldTransaction).to.changeTokenBalances(
      testERC20,
      [railgunSmartWalletSnarkBypass.address, secondaryAccount.address, treasuryAccount.address],
      [-totalUnshielded, unshieldAmounts.base, unshieldAmounts.fee],
    );

    // Scan transaction
    await merkletree.scanTX(unshieldTransaction, railgunSmartWalletSnarkBypass);
    await wallet1.scanTX(unshieldTransaction, railgunSmartWalletSnarkBypass);
    await wallet2.scanTX(unshieldTransaction, railgunSmartWalletSnarkBypass);

    // Check balances
    expect(await wallet1.getBalance(merkletree, tokenData)).to.equal(
      shieldAmounts.base - totalTransferred,
    );
    expect(await wallet2.getBalance(merkletree, tokenData)).to.equal(
      totalTransferred - totalUnshielded,
    );
  });

  it('Should shield, transfer, and withdraw ERC721', async () => {
    const { chainID, secondaryAccount, railgunSmartWalletSnarkBypass, testERC721 } =
      await loadFixture(deploy);

    // Create merkle tree and wallets
    const merkletree = await MerkleTree.createTree();
    const wallet1 = new Wallet(randomBytes(32), randomBytes(32));
    const wallet2 = new Wallet(randomBytes(32), randomBytes(32));

    // Shield a note
    const tokenData: TokenData = {
      tokenType: TokenType.ERC721,
      tokenAddress: testERC721.address,
      tokenSubID: 10n,
    };

    await testERC721.mint(await railgunSmartWalletSnarkBypass.signer.getAddress(), 10);

    wallet1.tokens.push(tokenData);
    wallet2.tokens.push(tokenData);

    const shieldNote = new Note(
      wallet1.spendingKey,
      wallet1.viewingKey,
      1n,
      randomBytes(16),
      tokenData,
      '',
    );

    const shieldTransaction = await railgunSmartWalletSnarkBypass.shield([
      await shieldNote.encryptForShield(),
    ]);

    // Check token moved correctly
    expect(await testERC721.ownerOf(10)).to.equal(railgunSmartWalletSnarkBypass.address);

    // Check tokenID mapping has been updated
    const tokenIDContractMapping = await railgunSmartWalletSnarkBypass.tokenIDMapping(
      getTokenID(tokenData),
    );
    expect(tokenIDContractMapping.tokenType).to.equal(tokenData.tokenType);
    expect(tokenIDContractMapping.tokenAddress).to.equal(tokenData.tokenAddress);
    expect(tokenIDContractMapping.tokenSubID).to.equal(tokenData.tokenSubID);

    // Scan transaction
    await merkletree.scanTX(shieldTransaction, railgunSmartWalletSnarkBypass);
    await wallet1.scanTX(shieldTransaction, railgunSmartWalletSnarkBypass);
    await wallet2.scanTX(shieldTransaction, railgunSmartWalletSnarkBypass);

    // Check balances
    expect(await wallet1.getBalance(merkletree, tokenData)).to.equal(1);
    expect(await wallet2.getBalance(merkletree, tokenData)).to.equal(0);

    // Transfer tokens between shielded balances
    const transferNotes = padWithDummyNotes(
      await wallet1.getTestTransactionInputs(
        merkletree,
        1,
        1,
        false,
        tokenData,
        wallet2.spendingKey,
        wallet2.viewingKey,
      ),
      2,
    );

    const transferTransaction = await railgunSmartWalletSnarkBypass.transact([
      await dummyTransact(
        merkletree,
        0n,
        UnshieldType.NONE,
        chainID,
        ethers.constants.AddressZero,
        new Uint8Array(32),
        transferNotes.inputs,
        transferNotes.outputs,
      ),
    ]);

    // Double spends should not be possible
    await expect(
      railgunSmartWalletSnarkBypass.transact([
        await dummyTransact(
          merkletree,
          0n,
          UnshieldType.NONE,
          chainID,
          ethers.constants.AddressZero,
          new Uint8Array(32),
          transferNotes.inputs,
          transferNotes.outputs,
        ),
      ]),
    ).to.be.revertedWith('RailgunLogic: Note already spent');

    // Scan transaction
    await merkletree.scanTX(transferTransaction, railgunSmartWalletSnarkBypass);
    await wallet1.scanTX(transferTransaction, railgunSmartWalletSnarkBypass);
    await wallet2.scanTX(transferTransaction, railgunSmartWalletSnarkBypass);

    // Check balances
    expect(await wallet1.getBalance(merkletree, tokenData)).to.equal(0);
    expect(await wallet2.getBalance(merkletree, tokenData)).to.equal(1);

    // Unshield tokens between shielded balances
    const unshieldNotes = padWithDummyNotes(
      await wallet2.getTestTransactionInputs(
        merkletree,
        1,
        1,
        secondaryAccount.address,
        tokenData,
        wallet2.spendingKey,
        wallet2.viewingKey,
      ),
      2,
    );

    const unshieldTransaction = await railgunSmartWalletSnarkBypass.transact([
      await dummyTransact(
        merkletree,
        0n,
        UnshieldType.NORMAL,
        chainID,
        ethers.constants.AddressZero,
        new Uint8Array(32),
        unshieldNotes.inputs,
        unshieldNotes.outputs,
      ),
    ]);

    // Check tokens amounts moved correctly
    expect(await testERC721.ownerOf(10)).to.equal(secondaryAccount.address);

    // Scan transaction
    await merkletree.scanTX(unshieldTransaction, railgunSmartWalletSnarkBypass);
    await wallet1.scanTX(unshieldTransaction, railgunSmartWalletSnarkBypass);
    await wallet2.scanTX(unshieldTransaction, railgunSmartWalletSnarkBypass);

    // Check balances
    expect(await wallet1.getBalance(merkletree, tokenData)).to.equal(0);
    expect(await wallet2.getBalance(merkletree, tokenData)).to.equal(0);
  });

  it('Should ensure note preimages are valid', async () => {
    const { railgunSmartWallet, testERC20 } = await loadFixture(deploy);

    // Shield notes
    const tokenData: TokenData = {
      tokenType: TokenType.ERC20,
      tokenAddress: testERC20.address,
      tokenSubID: 0n,
    };

    const shieldNotes = [
      new Note(randomBytes(32), randomBytes(32), 0n, randomBytes(16), tokenData, ''),
    ];

    await expect(
      railgunSmartWallet.shield([
        ...(await Promise.all(shieldNotes.map((note) => note.encryptForShield()))),
      ]),
    ).to.be.revertedWith('RailgunSmartWallet: Invalid Note Value');
  });

  it('Should reject invalid transactions', async () => {
    const { chainID, railgunSmartWallet, testERC20 } = await loadFixture(deploy);

    // Create merkle tree and wallets
    const merkletree = await MerkleTree.createTree();
    const wallet1 = new Wallet(randomBytes(32), randomBytes(32));
    const wallet2 = new Wallet(randomBytes(32), randomBytes(32));

    // Shield notes
    const tokenData: TokenData = {
      tokenType: TokenType.ERC20,
      tokenAddress: testERC20.address,
      tokenSubID: 0n,
    };

    wallet1.tokens.push(tokenData);

    const shieldNotes = [
      new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
      new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
      new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
      new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
      new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
    ];

    const shieldTransaction = await railgunSmartWallet.shield([
      ...(await Promise.all(shieldNotes.map((note) => note.encryptForShield()))),
    ]);

    // Scan transaction
    await merkletree.scanTX(shieldTransaction, railgunSmartWallet);
    await wallet1.scanTX(shieldTransaction, railgunSmartWallet);
    await wallet2.scanTX(shieldTransaction, railgunSmartWallet);

    // Transfer tokens between shielded balances
    const transferNotes = padWithDummyNotes(
      await wallet1.getTestTransactionInputs(
        merkletree,
        1,
        1,
        false,
        tokenData,
        wallet2.spendingKey,
        wallet2.viewingKey,
      ),
      2,
    );

    await expect(
      railgunSmartWallet.transact([
        await dummyTransact(
          merkletree,
          0n,
          UnshieldType.NONE,
          chainID,
          ethers.constants.AddressZero,
          new Uint8Array(32),
          transferNotes.inputs,
          transferNotes.outputs,
        ),
      ]),
    ).to.be.revertedWith('RailgunSmartWallet: Invalid Snark Proof');
  });

  it('Should no-op on empty calls', async () => {
    const { railgunSmartWallet } = await loadFixture(deploy);

    // Create merkle tree and wallets
    const merkletree = await MerkleTree.createTree();

    // Transactions should succeed
    await expect(railgunSmartWallet.shield([])).to.eventually.be.fulfilled;
    await expect(railgunSmartWallet.transact([])).to.eventually.be.fulfilled;

    // Merkle root shouldn't have changed
    expect(await railgunSmartWallet.merkleRoot()).to.equal(arrayToHexString(merkletree.root, true));

    // Tree number and next insertion index should still be 0
    expect(await railgunSmartWallet.treeNumber()).to.equal(0);
    expect(await railgunSmartWallet.nextLeafIndex()).to.equal(0);
  });

  it("Shouln't transfer anything out if ERC721 unshield value = 0", async () => {
    const { chainID, secondaryAccount, railgunSmartWalletSnarkBypass, testERC721 } =
      await loadFixture(deploy);

    // Create merkle tree and wallets
    const merkletree = await MerkleTree.createTree();
    const wallet = new Wallet(randomBytes(32), randomBytes(32));

    // Shield a note
    const tokenData: TokenData = {
      tokenType: TokenType.ERC721,
      tokenAddress: testERC721.address,
      tokenSubID: 10n,
    };

    await testERC721.mint(await railgunSmartWalletSnarkBypass.signer.getAddress(), 10);

    wallet.tokens.push(tokenData);

    const shieldNote = new Note(
      wallet.spendingKey,
      wallet.viewingKey,
      1n,
      randomBytes(16),
      tokenData,
      '',
    );

    const shieldTransaction = await railgunSmartWalletSnarkBypass.shield([
      await shieldNote.encryptForShield(),
    ]);

    // Scan transaction
    await merkletree.scanTX(shieldTransaction, railgunSmartWalletSnarkBypass);
    await wallet.scanTX(shieldTransaction, railgunSmartWalletSnarkBypass);

    // Check balances
    expect(await wallet.getBalance(merkletree, tokenData)).to.equal(1);

    // Unshield tokens between shielded balances
    const unshieldNotes = padWithDummyNotes(
      await wallet.getTestTransactionInputs(
        merkletree,
        1,
        1,
        secondaryAccount.address,
        tokenData,
        wallet.spendingKey,
        wallet.viewingKey,
      ),
      2,
    );

    unshieldNotes.outputs[0].value = 1n;
    unshieldNotes.outputs[1].value = 0n;

    const unshieldtx = await dummyTransact(
      merkletree,
      0n,
      UnshieldType.NORMAL,
      chainID,
      ethers.constants.AddressZero,
      new Uint8Array(32),
      unshieldNotes.inputs,
      unshieldNotes.outputs,
    );

    await expect(railgunSmartWalletSnarkBypass.transact([unshieldtx])).to.be.revertedWith(
      'RailgunSmartWallet: Invalid Note Value',
    );
  });

  it("Shouln't transfer anything out if ERC20 unshield value = 0", async function () {
    this.timeout(5 * 60 * 60 * 1000);
    const { chainID, treasuryAccount, secondaryAccount, railgunSmartWalletSnarkBypass, testERC20 } =
      await loadFixture(deploy);

    // Create merkle tree and wallets
    const merkletree = await MerkleTree.createTree();
    const wallet = new Wallet(randomBytes(32), randomBytes(32));

    // Shield notes
    const tokenData: TokenData = {
      tokenType: TokenType.ERC20,
      tokenAddress: testERC20.address,
      tokenSubID: 0n,
    };

    wallet.tokens.push(tokenData);

    const shieldNotes = [
      new Note(wallet.spendingKey, wallet.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
      new Note(wallet.spendingKey, wallet.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
      new Note(wallet.spendingKey, wallet.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
      new Note(wallet.spendingKey, wallet.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
      new Note(wallet.spendingKey, wallet.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
    ];

    const shieldTransaction = await railgunSmartWalletSnarkBypass.shield([
      ...(await Promise.all(shieldNotes.map((note) => note.encryptForShield()))),
    ]);

    // Check lastEventBlock updated
    expect(await railgunSmartWalletSnarkBypass.lastEventBlock()).to.equal(
      shieldTransaction.blockNumber,
    );

    const totalShielded = shieldNotes
      .map((note) => note.value)
      .reduce((left, right) => left + right);

    // Calculate shield amounts
    const shieldAmounts = getFee(
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
      [-totalShielded, shieldAmounts.base, shieldAmounts.fee],
    );

    // Scan transaction
    await merkletree.scanTX(shieldTransaction, railgunSmartWalletSnarkBypass);
    await wallet.scanTX(shieldTransaction, railgunSmartWalletSnarkBypass);

    // Check balances
    expect(await wallet.getBalance(merkletree, tokenData)).to.equal(shieldAmounts.base);

    // Unshield tokens between shielded balances
    const unshieldNotes = await wallet.getTestTransactionInputs(
      merkletree,
      2,
      3,
      secondaryAccount.address,
      tokenData,
      wallet.spendingKey,
      wallet.viewingKey,
    );

    unshieldNotes.outputs[2].value = 0n;

    const unshieldtx = await dummyTransact(
      merkletree,
      0n,
      UnshieldType.NORMAL,
      chainID,
      ethers.constants.AddressZero,
      new Uint8Array(32),
      unshieldNotes.inputs,
      unshieldNotes.outputs,
    );

    await expect(railgunSmartWalletSnarkBypass.transact([unshieldtx])).to.be.revertedWith(
      'RailgunSmartWallet: Invalid Note Value',
    );
  });
});
