import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  loadFixture,
  setBalance,
  impersonateAccount,
} from '@nomicfoundation/hardhat-network-helpers';

import {
  ciphertextMatcher,
  commitmentPreimageMatcher,
  dummyTransact,
  getFee,
  nullifiersMatcher,
  tokenDataMatcher,
  transact,
  UnshieldType,
} from '../../helpers/logic/transaction';
import { Note, TokenType, UnshieldNote } from '../../helpers/logic/note';
import { randomBytes } from '../../helpers/global/crypto';
import { arrayToHexString } from '../../helpers/global/bytes';
import { MerkleTree } from '../../helpers/logic/merkletree';
import { loadAllArtifacts } from '../../helpers/logic/artifacts';

describe('Logic/RailgunLogic', () => {
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
    const [primaryAccount, treasuryAccount, adminAccount, proxyAdminAccount] =
      await ethers.getSigners();

    // Deploy poseidon libraries
    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const PoseidonT4 = await ethers.getContractFactory('PoseidonT4');
    const poseidonT3 = await PoseidonT3.deploy();
    const poseidonT4 = await PoseidonT4.deploy();

    // Deploy RailgunLogic
    const RailgunLogic = await ethers.getContractFactory('RailgunLogicStub', {
      libraries: {
        PoseidonT3: poseidonT3.address,
        PoseidonT4: poseidonT4.address,
      },
    });
    let railgunLogic = await RailgunLogic.deploy();

    // Deploy Proxy and set implementation
    const Proxy = await ethers.getContractFactory('PausableUpgradableProxy');
    let proxy = await Proxy.deploy(proxyAdminAccount.address);
    proxy = proxy.connect(proxyAdminAccount);
    await proxy.upgrade(railgunLogic.address);
    railgunLogic = railgunLogic.attach(proxy.address);
    await proxy.unpause();

    await railgunLogic.initializeRailgunLogic(
      treasuryAccount.address,
      40,
      30,
      25,
      adminAccount.address,
    );

    // Get alternative signers
    const railgunLogicSnarkBypass = railgunLogic.connect(snarkBypassSigner);
    const railgunLogicAdmin = railgunLogic.connect(adminAccount);

    // Load verification keys
    await loadAllArtifacts(railgunLogicAdmin);

    // Deploy test ERC20 and approve for shield
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    const testERC20 = await TestERC20.deploy();
    const testERC20BypassSigner = testERC20.connect(snarkBypassSigner);
    await testERC20.mint(primaryAccount.address, 2n ** 128n - 1n);
    await testERC20.mint('0x000000000000000000000000000000000000dEaD', 2n ** 128n - 1n);
    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);
    await testERC20BypassSigner.approve(railgunLogic.address, 2n ** 256n - 1n);

    // Deploy test ERC721 and approve for shield
    const TestERC721 = await ethers.getContractFactory('TestERC721');
    const testERC721 = await TestERC721.deploy();
    const testERC721BypassSigner = testERC721.connect(snarkBypassSigner);
    await testERC721.setApprovalForAll(railgunLogic.address, true);
    await testERC721BypassSigner.setApprovalForAll(railgunLogic.address, true);

    return {
      primaryAccount,
      adminAccount,
      treasuryAccount,
      railgunLogic,
      railgunLogicSnarkBypass,
      railgunLogicAdmin,
      testERC20,
      testERC20BypassSigner,
      testERC721,
      testERC721BypassSigner,
    };
  }

  it("Shouldn't initialize twice", async () => {
    const { adminAccount, treasuryAccount, railgunLogic } = await loadFixture(deploy);

    await expect(
      railgunLogic.doubleInit(treasuryAccount.address, 25, 25, 0, adminAccount.address),
    ).to.be.revertedWith('Initializable: contract is already initialized');
  });

  it('Should change fee', async () => {
    const { railgunLogic, railgunLogicAdmin } = await loadFixture(deploy);

    // Check initial fees
    expect(await railgunLogicAdmin.shieldFee()).to.equal(40n);
    expect(await railgunLogicAdmin.unshieldFee()).to.equal(30n);
    expect(await railgunLogicAdmin.nftFee()).to.equal(25n);

    // Change fee
    await expect(railgunLogicAdmin.changeFee(1n, 30n, 25n))
      .to.emit(railgunLogicAdmin, 'FeeChange')
      .withArgs(1n, 30n, 25n);
    await expect(railgunLogicAdmin.changeFee(1n, 2n, 25n))
      .to.emit(railgunLogicAdmin, 'FeeChange')
      .withArgs(1n, 2n, 25n);
    await expect(railgunLogicAdmin.changeFee(1n, 2n, 3n))
      .to.emit(railgunLogicAdmin, 'FeeChange')
      .withArgs(1n, 2n, 3n);

    // Noop calls shouldn't emit event
    await expect(railgunLogicAdmin.changeFee(1n, 2n, 3n)).to.not.emit(
      railgunLogicAdmin,
      'FeeChange',
    );

    // Check changed fees
    expect(await railgunLogicAdmin.shieldFee()).to.equal(1n);
    expect(await railgunLogicAdmin.unshieldFee()).to.equal(2n);
    expect(await railgunLogicAdmin.nftFee()).to.equal(3n);

    // Make sure only governance can change fees
    await expect(railgunLogic.changeFee(4n, 5n, 6n)).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );

    // Fees shouldn't be able to be set to more than 100%
    await expect(railgunLogicAdmin.changeFee(10001n, 5n, 6n)).to.be.revertedWith(
      'RailgunLogic: Shield Fee exceeds 100%',
    );
    await expect(railgunLogicAdmin.changeFee(3n, 10001n, 6n)).to.be.revertedWith(
      'RailgunLogic: Unshield Fee exceeds 100%',
    );
  });

  it('Should change treasury', async () => {
    const { railgunLogic, railgunLogicAdmin, primaryAccount, treasuryAccount } = await loadFixture(
      deploy,
    );

    // Check treasury changes
    expect(await railgunLogicAdmin.treasury()).to.equal(treasuryAccount.address);
    await expect(railgunLogicAdmin.changeTreasury(ethers.constants.AddressZero))
      .to.emit(railgunLogicAdmin, 'TreasuryChange')
      .withArgs(ethers.constants.AddressZero);
    expect(await railgunLogicAdmin.treasury()).to.equal(ethers.constants.AddressZero);
    await expect(railgunLogicAdmin.changeTreasury(primaryAccount.address))
      .to.emit(railgunLogicAdmin, 'TreasuryChange')
      .withArgs(primaryAccount.address);

    // Noop calls shouldn't emit event
    await expect(railgunLogicAdmin.changeTreasury(primaryAccount.address)).to.not.emit(
      railgunLogicAdmin,
      'TreasuryChange',
    );

    expect(await railgunLogicAdmin.treasury()).to.equal(primaryAccount.address);

    // Make sure only governance can change treasury
    await expect(railgunLogic.changeTreasury(ethers.constants.AddressZero)).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );
  });

  it('Should calculate fee', async () => {
    const { railgunLogic } = await loadFixture(deploy);

    const loops = 5;

    // Loop through fee basis points
    for (let feeBP = 0; feeBP < loops; feeBP += 1) {
      // Loop through amounts from 10 to 10^15
      for (let i = 1; i <= 15; i += 1) {
        // Get base amount
        const base = 10n ** BigInt(i);

        // Get fee amount
        const { fee } = getFee(base, false, BigInt(feeBP));

        // Get total
        const total = base + fee;

        // Check result is correct for exclusive amount
        expect(await railgunLogic.getFee(base, false, feeBP)).to.deep.equal([base, fee]);

        // Check result is correct for inclusive amount
        expect(await railgunLogic.getFee(total, true, feeBP)).to.deep.equal([base, fee]);
      }
    }
  });

  it('Should get token field', async () => {
    const { railgunLogic } = await loadFixture(deploy);

    const loops = 5;

    for (let iter = 0; iter <= 5; iter += 1) {
      const erc20Note = new Note(
        randomBytes(32),
        randomBytes(32),
        BigInt(loops),
        randomBytes(16),
        {
          tokenType: TokenType.ERC20,
          tokenAddress: arrayToHexString(randomBytes(20), true),
          tokenSubID: 0n,
        },
        '',
      );

      expect(await railgunLogic.getTokenID(erc20Note.tokenData)).to.deep.equal(
        arrayToHexString(erc20Note.getTokenID(), true),
      );

      const erc721Note = new Note(
        randomBytes(32),
        randomBytes(32),
        BigInt(loops),
        randomBytes(16),
        {
          tokenType: TokenType.ERC721,
          tokenAddress: arrayToHexString(randomBytes(20), true),
          tokenSubID: BigInt(loops * 2),
        },
        '',
      );

      expect(await railgunLogic.getTokenID(erc721Note.tokenData)).to.deep.equal(
        arrayToHexString(erc721Note.getTokenID(), true),
      );

      const erc1155Note = new Note(
        randomBytes(32),
        randomBytes(32),
        BigInt(loops),
        randomBytes(16),
        {
          tokenType: TokenType.ERC1155,
          tokenAddress: arrayToHexString(randomBytes(20), true),
          tokenSubID: BigInt(loops * 2),
        },
        '',
      );

      expect(await railgunLogic.getTokenID(erc1155Note.tokenData)).to.deep.equal(
        arrayToHexString(erc1155Note.getTokenID(), true),
      );
    }
  });

  it('Should pass safety vector checks', async () => {
    const { railgunLogic, railgunLogicAdmin, primaryAccount } = await loadFixture(deploy);
    await expect(railgunLogic.treasury()).to.be.fulfilled;
    await expect(railgunLogic.checkSafetyVectors()).to.be.reverted;
    await expect(railgunLogic.treasury()).to.be.fulfilled;
    await expect(railgunLogic.addVector(BigInt(primaryAccount.address))).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );
    await railgunLogicAdmin.addVector(BigInt(primaryAccount.address));
    await expect(railgunLogic.removeVector(BigInt(primaryAccount.address))).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );
    await railgunLogicAdmin.removeVector(BigInt(primaryAccount.address));
    await expect(railgunLogic.checkSafetyVectors()).to.be.reverted;
    await railgunLogicAdmin.addVector(BigInt(primaryAccount.address));
    await expect(railgunLogic.treasury()).to.be.fulfilled;
    await expect(railgunLogic.checkSafetyVectors()).to.be.fulfilled;
    await expect(railgunLogic.treasury()).to.be.reverted;
  });

  it('Should hash commitments', async () => {
    const { railgunLogic } = await loadFixture(deploy);

    const loops = 5;

    for (let iter = 0; iter <= 5; iter += 1) {
      const erc20Note = new Note(
        randomBytes(32),
        randomBytes(32),
        BigInt(loops),
        randomBytes(16),
        {
          tokenType: TokenType.ERC20,
          tokenAddress: arrayToHexString(randomBytes(20), true),
          tokenSubID: 0n,
        },
        '',
      );

      expect(
        await railgunLogic.hashCommitment(await erc20Note.getCommitmentPreimage()),
      ).to.deep.equal(arrayToHexString(await erc20Note.getHash(), true));

      const erc721Note = new Note(
        randomBytes(32),
        randomBytes(32),
        BigInt(loops),
        randomBytes(16),
        {
          tokenType: TokenType.ERC721,
          tokenAddress: arrayToHexString(randomBytes(20), true),
          tokenSubID: BigInt(loops * 2),
        },
        '',
      );

      expect(
        await railgunLogic.hashCommitment(await erc721Note.getCommitmentPreimage()),
      ).to.deep.equal(arrayToHexString(await erc721Note.getHash(), true));

      const erc1155Note = new Note(
        randomBytes(32),
        randomBytes(32),
        BigInt(loops),
        randomBytes(16),
        {
          tokenType: TokenType.ERC1155,
          tokenAddress: arrayToHexString(randomBytes(20), true),
          tokenSubID: BigInt(loops * 2),
        },
        '',
      );

      expect(
        await railgunLogic.hashCommitment(await erc1155Note.getCommitmentPreimage()),
      ).to.deep.equal(arrayToHexString(await erc1155Note.getHash(), true));
    }
  });

  it('Should validate commitments', async () => {
    const { railgunLogic, railgunLogicAdmin } = await loadFixture(deploy);

    // Check valid ERC20 note returns true
    const validNote = new Note(
      randomBytes(32),
      randomBytes(32),
      100n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC20,
        tokenAddress: arrayToHexString(randomBytes(20), true),
        tokenSubID: 0n,
      },
      '',
    );

    expect(
      await railgunLogic.validateCommitmentPreimage(await validNote.getCommitmentPreimage()),
    ).to.equal(true);

    // Check valid ERC721 note returns true
    const validERC721Note = new Note(
      randomBytes(32),
      randomBytes(32),
      1n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC721,
        tokenAddress: arrayToHexString(randomBytes(20), true),
        tokenSubID: 10n,
      },
      '',
    );

    expect(
      await railgunLogic.validateCommitmentPreimage(await validERC721Note.getCommitmentPreimage()),
    ).to.equal(true);

    // Check ERC721 note with non-one value returns false
    const invalidERC721Note = new Note(
      randomBytes(32),
      randomBytes(32),
      2n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC721,
        tokenAddress: arrayToHexString(randomBytes(20), true),
        tokenSubID: 10n,
      },
      '',
    );

    expect(
      await railgunLogic.validateCommitmentPreimage(
        await invalidERC721Note.getCommitmentPreimage(),
      ),
    ).to.equal(false);

    // Check zero value note returns false
    const zeroNote = new Note(
      randomBytes(32),
      randomBytes(32),
      0n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC20,
        tokenAddress: arrayToHexString(randomBytes(20), true),
        tokenSubID: 0n,
      },
      '',
    );

    expect(
      await railgunLogic.validateCommitmentPreimage(await zeroNote.getCommitmentPreimage()),
    ).to.equal(false);

    // Check note with npk out of range returns false
    const invalidNPK = await validNote.getCommitmentPreimage();
    invalidNPK.npk = new Uint8Array(32).fill(255);

    expect(await railgunLogic.validateCommitmentPreimage(invalidNPK)).to.equal(false);

    // Check blocklisted token returns false
    await railgunLogicAdmin.addToBlocklist([validNote.tokenData.tokenAddress]);

    expect(
      await railgunLogic.validateCommitmentPreimage(await validNote.getCommitmentPreimage()),
    ).to.equal(false);
  });

  it('Should sum commitments in a transaction', async () => {
    const { railgunLogic } = await loadFixture(deploy);

    const loops = 5;

    // Create random viewing and spending keys
    const spendingKey = randomBytes(32);
    const viewingKey = randomBytes(32);
    const tokenData = {
      tokenType: TokenType.ERC20,
      tokenAddress: ethers.constants.AddressZero,
      tokenSubID: 0n,
    };

    for (let i = 1; i < loops; i += 1) {
      // Create notes in and notes out
      const notesIn = new Array(i * 2)
        .fill(1)
        .map(() => new Note(spendingKey, viewingKey, 50n, randomBytes(16), tokenData, ''));

      const notesOut = new Array(i)
        .fill(1)
        .map(() => new Note(spendingKey, viewingKey, 100n, randomBytes(16), tokenData, ''));

      const notesOutUnshield: (Note | UnshieldNote)[] = new Array(i)
        .fill(1)
        .map(() => new Note(spendingKey, viewingKey, 100n, randomBytes(16), tokenData, ''));

      notesOutUnshield[notesOutUnshield.length - 1] = new UnshieldNote(
        ethers.constants.AddressZero,
        100n,
        tokenData,
      );

      // Create merkle tree and insert notes
      const tree = await MerkleTree.createTree();
      await tree.insertLeaves(await Promise.all(notesIn.map((note) => note.getHash())), 0);

      // Get transaction
      const transaction = await dummyTransact(
        tree,
        0n,
        UnshieldType.NONE,
        ethers.constants.AddressZero,
        new Uint8Array(32),
        notesIn,
        notesOut,
      );

      // Get unshield transaction
      const unshieldTransaction = await dummyTransact(
        tree,
        0n,
        UnshieldType.NORMAL,
        ethers.constants.AddressZero,
        new Uint8Array(32),
        notesIn,
        notesOut,
      );

      // Check transaction commitment count
      for (let n = 1; n < loops; n += 1) {
        // Build transaction array
        const transactions = new Array(n).fill(1).map(() => transaction);
        const unshieldTransactions = new Array(n).fill(1).map(() => unshieldTransaction);

        expect(
          await railgunLogic.sumCommitments([...transactions, ...unshieldTransactions]),
        ).to.equal(i * n + (i - 1) * n);
      }
    }
  });

  it('Should validate transaction', async () => {
    const { railgunLogic, railgunLogicSnarkBypass } = await loadFixture(deploy);

    // Create random viewing and spending keys
    const spendingKey = randomBytes(32);
    const viewingKey = randomBytes(32);
    const tokenData = {
      tokenType: TokenType.ERC20,
      tokenAddress: ethers.constants.AddressZero,
      tokenSubID: 0n,
    };

    // Create notes in and notes out
    const notesIn = new Array(2)
      .fill(1)
      .map(() => new Note(spendingKey, viewingKey, 300n, randomBytes(16), tokenData, ''));

    const notesOut = new Array(3)
      .fill(1)
      .map(() => new Note(spendingKey, viewingKey, 200n, randomBytes(16), tokenData, ''));

    const notesOutUnshield: (Note | UnshieldNote)[] = new Array(3)
      .fill(1)
      .map(() => new Note(spendingKey, viewingKey, 200n, randomBytes(16), tokenData, ''));

    notesOutUnshield[notesOutUnshield.length - 1] = new UnshieldNote(
      await railgunLogicSnarkBypass.signer.getAddress(),
      100n,
      tokenData,
    );

    // Create merkle tree and insert notes
    const tree = await MerkleTree.createTree();
    await tree.insertLeaves(await Promise.all(notesIn.map((note) => note.getHash())), 0);

    // Set merkle root on contract
    await railgunLogic.setMerkleRoot(0, tree.root, true);

    // Create dummy transactions
    const dummyTransaction = await dummyTransact(
      tree,
      100n,
      UnshieldType.NONE,
      ethers.constants.AddressZero,
      new Uint8Array(32),
      notesIn,
      notesOut,
    );

    const dummyTransactionUnshield = await dummyTransact(
      tree,
      100n,
      UnshieldType.NORMAL,
      ethers.constants.AddressZero,
      new Uint8Array(32),
      notesIn,
      notesOutUnshield,
    );

    let dummyTransactionUnshieldRedirect = await dummyTransact(
      tree,
      100n,
      UnshieldType.REDIRECT,
      ethers.constants.AddressZero,
      new Uint8Array(32),
      notesIn,
      notesOutUnshield,
    );

    // Should return true for valid transactions
    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransaction, { gasPrice: 100 }),
    ).to.equal(true);

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransactionUnshield, {
        gasPrice: 100,
      }),
    ).to.equal(true);

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransactionUnshieldRedirect, {
        gasPrice: 100,
      }),
    ).to.equal(true);

    // Should return false if min gas price is too low
    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransaction, { gasPrice: 10 }),
    ).to.equal(false);

    // Should return false if adaptContract is set to non-0 and not the submitter's address
    dummyTransaction.boundParams.adaptContract = await railgunLogicSnarkBypass.signer.getAddress();

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransaction, { gasPrice: 100 }),
    ).to.equal(true);

    dummyTransaction.boundParams.adaptContract = arrayToHexString(randomBytes(20), true);

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransaction, { gasPrice: 100 }),
    ).to.equal(false);

    dummyTransaction.boundParams.adaptContract = ethers.constants.AddressZero;

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransaction, { gasPrice: 100 }),
    ).to.equal(true);

    // Should return false if invalid merkle root
    await railgunLogic.setMerkleRoot(0, tree.root, false);

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransaction, { gasPrice: 100 }),
    ).to.equal(false);

    await railgunLogic.setMerkleRoot(0, tree.root, true);

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransaction, { gasPrice: 100 }),
    ).to.equal(true);

    // Should return false if nullifier has been seen before
    await railgunLogic.setNullifier(0, dummyTransaction.nullifiers[0], true);

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransaction, { gasPrice: 100 }),
    ).to.equal(false);

    await railgunLogic.setNullifier(0, dummyTransaction.nullifiers[0], false);

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransaction, { gasPrice: 100 }),
    ).to.equal(true);

    // Should return false if incorrect number of ciphertext
    dummyTransaction.boundParams.commitmentCiphertext.push({
      ciphertext: [randomBytes(32), randomBytes(32), randomBytes(32), randomBytes(32)],
      blindedReceiverViewingKey: randomBytes(32),
      blindedSenderViewingKey: randomBytes(32),
      annotationData: randomBytes(48),
      memo: randomBytes(123),
    });

    dummyTransactionUnshield.boundParams.commitmentCiphertext.push({
      ciphertext: [randomBytes(32), randomBytes(32), randomBytes(32), randomBytes(32)],
      blindedReceiverViewingKey: randomBytes(32),
      blindedSenderViewingKey: randomBytes(32),
      annotationData: randomBytes(48),
      memo: randomBytes(123),
    });

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransaction, { gasPrice: 100 }),
    ).to.equal(false);

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransactionUnshield, {
        gasPrice: 100,
      }),
    ).to.equal(false);

    dummyTransaction.boundParams.commitmentCiphertext.pop();

    dummyTransactionUnshield.boundParams.commitmentCiphertext.pop();

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransaction, { gasPrice: 100 }),
    ).to.equal(true);

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransactionUnshield, {
        gasPrice: 100,
      }),
    ).to.equal(true);

    // Should return false for invalid unshield preimage
    dummyTransactionUnshield.unshieldPreimage.value += 100n;
    dummyTransactionUnshieldRedirect.unshieldPreimage.value += 100n;

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransactionUnshield, {
        gasPrice: 100,
      }),
    ).to.equal(false);

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransactionUnshieldRedirect, {
        gasPrice: 100,
      }),
    ).to.equal(false);

    dummyTransactionUnshield.unshieldPreimage.value -= 100n;
    dummyTransactionUnshieldRedirect.unshieldPreimage.value -= 100n;

    // Should return false if redirect transaction is submitted from an address that isn't the original recipient
    notesOutUnshield[notesOutUnshield.length - 1] = new UnshieldNote(
      await railgunLogic.signer.getAddress(),
      100n,
      tokenData,
    );

    dummyTransactionUnshieldRedirect = await dummyTransact(
      tree,
      100n,
      UnshieldType.REDIRECT,
      ethers.constants.AddressZero,
      new Uint8Array(32),
      notesIn,
      notesOutUnshield,
    );

    expect(
      await railgunLogicSnarkBypass.validateTransaction(dummyTransactionUnshieldRedirect, {
        gasPrice: 100,
      }),
    ).to.equal(false);

    if (process.env.LONG_TESTS === 'yes') {
      // Generate SNARK proof
      const transaction = await transact(
        tree,
        100n,
        UnshieldType.NONE,
        ethers.constants.AddressZero,
        new Uint8Array(32),
        notesIn,
        notesOut,
      );

      // Should return true for transaction with valid snark proof
      expect(await railgunLogic.validateTransaction(transaction, { gasPrice: 100 })).to.equal(true);

      // Should return false for transaction without valid snark proof
      expect(await railgunLogic.validateTransaction(dummyTransaction, { gasPrice: 100 })).to.equal(
        false,
      );
    }
  });

  it('Should accumulate and nullify transaction', async () => {
    const { railgunLogic } = await loadFixture(deploy);

    const loops = 5;

    // Create random viewing and spending keys
    const spendingKey = randomBytes(32);
    const viewingKey = randomBytes(32);
    const tokenData = {
      tokenType: TokenType.ERC20,
      tokenAddress: ethers.constants.AddressZero,
      tokenSubID: 0n,
    };

    for (let i = 1; i < loops; i += 1) {
      // Create notes in and notes out
      const notesIn = new Array(i * 2)
        .fill(1)
        .map(() => new Note(spendingKey, viewingKey, 50n, randomBytes(16), tokenData, ''));

      const notesOut = new Array(i)
        .fill(1)
        .map(() => new Note(spendingKey, viewingKey, 100n, randomBytes(16), tokenData, ''));

      // Create merkle tree and insert notes
      const tree = await MerkleTree.createTree();
      await tree.insertLeaves(await Promise.all(notesIn.map((note) => note.getHash())), 0);

      // Get transaction
      const transaction = await dummyTransact(
        tree,
        0n,
        UnshieldType.NONE,
        ethers.constants.AddressZero,
        new Uint8Array(32),
        notesIn,
        notesOut,
      );

      // Check nullifier event is emitted
      await expect(railgunLogic.accumulateAndNullifyTransactionStub(transaction, i, 0))
        .to.emit(railgunLogic, 'Nullifiers')
        .withArgs(0, nullifiersMatcher(transaction.nullifiers));

      // Check returned values match transaction values
      const accumulateAndNullifyReturned =
        await railgunLogic.callStatic.accumulateAndNullifyTransactionStub(transaction, i, 0);

      expect(accumulateAndNullifyReturned[0]).to.equal(i);

      expect(accumulateAndNullifyReturned[1]).to.deep.equal(
        transaction.commitments.map((commitment) => arrayToHexString(commitment, true)),
      );

      expect(
        ciphertextMatcher(transaction.boundParams.commitmentCiphertext)(
          accumulateAndNullifyReturned[2],
        ),
      ).to.equal(true);

      // Check returned values match transaction values with offset values
      const accumulateAndNullifyReturnedOffset =
        await railgunLogic.callStatic.accumulateAndNullifyTransactionStub(transaction, i + 1, 1);

      expect(accumulateAndNullifyReturnedOffset[0]).to.equal(i + 1);

      expect(accumulateAndNullifyReturnedOffset[1]).to.deep.equal([
        ethers.constants.HashZero,
        ...transaction.commitments.map((commitment) => arrayToHexString(commitment, true)),
      ]);

      expect(
        ciphertextMatcher([
          {
            ciphertext: [
              new Uint8Array(32),
              new Uint8Array(32),
              new Uint8Array(32),
              new Uint8Array(32),
            ],
            blindedReceiverViewingKey: new Uint8Array(32),
            blindedSenderViewingKey: new Uint8Array(32),
            memo: new Uint8Array(0),
            annotationData: new Uint8Array(0),
          },
          ...transaction.boundParams.commitmentCiphertext,
        ])(accumulateAndNullifyReturnedOffset[2]),
      ).to.equal(true);
    }
  });

  it('Should transfer tokens in', async () => {
    const { railgunLogic, testERC20, testERC721, treasuryAccount } = await loadFixture(deploy);

    const loops = 5;

    // Create random viewing and spending keys
    const spendingKey = randomBytes(32);
    const viewingKey = randomBytes(32);

    const tokenDataERC20 = {
      tokenType: TokenType.ERC20,
      tokenAddress: testERC20.address,
      tokenSubID: 0n,
    };

    for (let i = 1; i < loops; i += 1) {
      // Check ERC20 gets transferred
      const erc20Note = new Note(
        spendingKey,
        viewingKey,
        BigInt(i) * 10n ** 18n,
        randomBytes(16),
        tokenDataERC20,
        '',
      );

      const preimageERC20 = await erc20Note.getCommitmentPreimage();

      const { base, fee } = getFee(
        erc20Note.value,
        true,
        (await railgunLogic.shieldFee()).toBigInt(),
      );

      // Check ERC20 note gets adjusted correctly
      const adjustedPreimageERC20 = await railgunLogic.callStatic.transferTokenInStub(
        preimageERC20,
      );
      expect(
        commitmentPreimageMatcher([
          {
            npk: preimageERC20.npk,
            token: preimageERC20.token,
            value: base,
          },
        ])([adjustedPreimageERC20]),
      ).to.equal(true);

      // Check balances are transferred
      await expect(railgunLogic.transferTokenInStub(preimageERC20)).to.changeTokenBalances(
        testERC20,
        [await railgunLogic.signer.getAddress(), railgunLogic.address, treasuryAccount.address],
        [-erc20Note.value, base, fee],
      );

      // Check ERC721 gets transferred
      await testERC721.mint(await railgunLogic.signer.getAddress(), i);

      const tokenDataERC721 = {
        tokenType: TokenType.ERC721,
        tokenAddress: testERC721.address,
        tokenSubID: BigInt(i),
      };

      const erc721Note = new Note(
        spendingKey,
        viewingKey,
        1n,
        randomBytes(16),
        tokenDataERC721,
        '',
      );

      // Check ERC721 preimage isn't adjusted
      const preimageERC721 = await erc721Note.getCommitmentPreimage();
      const adjustedPreimageERC721 = await railgunLogic.callStatic.transferTokenInStub(
        preimageERC721,
      );
      expect(commitmentPreimageMatcher([preimageERC721])([adjustedPreimageERC721])).to.equal(true);

      // Check ERC721 is transferred
      await railgunLogic.transferTokenInStub(await erc721Note.getCommitmentPreimage());
      expect(await testERC721.ownerOf(i)).to.equal(railgunLogic.address);

      // Check ERC1155 is rejected
      const tokenDataERC1155 = {
        tokenType: TokenType.ERC1155,
        tokenAddress: testERC20.address,
        tokenSubID: BigInt(i),
      };

      const erc1155Note = new Note(
        spendingKey,
        viewingKey,
        10n ** 18n,
        randomBytes(16),
        tokenDataERC1155,
        '',
      );

      await expect(
        railgunLogic.transferTokenInStub(await erc1155Note.getCommitmentPreimage()),
      ).to.be.revertedWith('RailgunLogic: ERC1155 not yet supported');
    }
  });

  it('Should transfer tokens out', async () => {
    const { railgunLogic, testERC20, testERC721, treasuryAccount } = await loadFixture(deploy);

    const loops = 5;

    const tokenDataERC20 = {
      tokenType: TokenType.ERC20,
      tokenAddress: testERC20.address,
      tokenSubID: 0n,
    };

    await testERC20.mint(railgunLogic.address, 2n ** 128n - 1n);

    for (let i = 1; i < loops; i += 1) {
      // Check ERC20 gets transferred
      const erc20Note = new UnshieldNote(
        await railgunLogic.signer.getAddress(),
        BigInt(i) * 10n ** 18n,
        tokenDataERC20,
      );

      const { base, fee } = getFee(
        erc20Note.value,
        true,
        (await railgunLogic.unshieldFee()).toBigInt(),
      );

      const erc20UnshieldTX = await railgunLogic.transferTokenOutStub(
        erc20Note.getCommitmentPreimage(),
      );

      await expect(erc20UnshieldTX).to.changeTokenBalances(
        testERC20,
        [await railgunLogic.signer.getAddress(), railgunLogic.address, treasuryAccount.address],
        [base, -erc20Note.value, fee],
      );

      await expect(erc20UnshieldTX)
        .to.emit(railgunLogic, 'Unshield')
        .withArgs(
          await railgunLogic.signer.getAddress(),
          tokenDataMatcher(tokenDataERC20),
          base,
          fee,
        );

      // Check ERC721 gets transferred
      await testERC721.mint(railgunLogic.address, i);

      const tokenDataERC721 = {
        tokenType: TokenType.ERC721,
        tokenAddress: testERC721.address,
        tokenSubID: BigInt(i),
      };

      const erc721Note = new UnshieldNote(
        await railgunLogic.signer.getAddress(),
        1n,
        tokenDataERC721,
      );

      const erc721UnshieldTX = await railgunLogic.transferTokenOutStub(
        erc721Note.getCommitmentPreimage(),
      );

      await expect(erc721UnshieldTX)
        .to.emit(railgunLogic, 'Unshield')
        .withArgs(await railgunLogic.signer.getAddress(), tokenDataMatcher(tokenDataERC721), 1, 0);

      expect(await testERC721.ownerOf(i)).to.equal(await railgunLogic.signer.getAddress());

      // Check ERC1155 is rejected
      const tokenDataERC1155 = {
        tokenType: TokenType.ERC1155,
        tokenAddress: testERC20.address,
        tokenSubID: BigInt(i),
      };

      const erc1155Note = new UnshieldNote(
        await railgunLogic.signer.getAddress(),
        1n,
        tokenDataERC1155,
      );

      await expect(
        railgunLogic.transferTokenOutStub(erc1155Note.getCommitmentPreimage()),
      ).to.be.revertedWith('RailgunLogic: ERC1155 not yet supported');
    }
  });
});
