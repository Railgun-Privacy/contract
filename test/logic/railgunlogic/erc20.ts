import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  loadFixture,
  setBalance,
  impersonateAccount,
} from '@nomicfoundation/hardhat-network-helpers';

import { edBabyJubJub } from '../../../helpers/global/crypto';
import { arrayToHexString, bigIntToArray } from '../../../helpers/global/bytes';

import { MerkleTree } from '../../../helpers/logic/merkletree';
import { Wallet } from '../../../helpers/logic/wallet';
import { Note, TokenType } from '../../../helpers/logic/note';
import {
  ciphertextMatcher,
  commitmentPreimageMatcher,
  dummyTransact,
  encryptedRandomMatcher,
  getFee,
  hashesMatcher,
  nullifiersMatcher,
  tokenDataMatcher,
  transact,
  WithdrawType,
} from '../../../helpers/logic/transaction';
import { availableArtifacts, loadAllArtifacts } from '../../../helpers/logic/artifacts';
import { randomBytes } from 'crypto';

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
    const [primaryAccount, secondaryAccount, treasuryAccount, adminAccount] =
      await ethers.getSigners();

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

    // Set verifier keys
    await loadAllArtifacts(railgunLogicAdmin);

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
      secondaryAccount,
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
    const { railgunLogic, primaryAccount, treasuryAccount, testERC20 } = await loadFixture(deploy);

    const loops = 5;

    // Create random keys
    const viewingKey = edBabyJubJub.genRandomPrivateKey();
    const spendingKey = edBabyJubJub.genRandomPrivateKey();

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
      const encryptedRandoms = notes.map((note) => note.encryptedRandom);

      // Fetch commitment preimages
      const preimages = await Promise.all(notes.map((note) => note.getCommitmentPreimage()));

      // Get transaction
      const tx = await railgunLogic.generateDeposit(preimages, encryptedRandoms);

      // Check contract ensures random and preimages length matches
      await expect(
        railgunLogic.generateDeposit(preimages, [...encryptedRandoms, ...encryptedRandoms]),
      ).to.be.revertedWith("RailgunLogic: notes and encrypted random length doesn't match");

      // Calculate total value of deposits
      const total = notes.map((note) => note.value).reduce((left, right) => left + right);

      // Get fees
      const { base, fee } = getFee(total, true, depositFeeBP);

      // Get commitment preimages adjusted by deposit fee
      const adjustedPreimages = preimages.map((preimage) => {
        // Get base
        const noteBase = getFee(preimage.value, true, depositFeeBP).base;

        return {
          npk: preimage.npk,
          token: preimage.token,
          value: noteBase,
        };
      });

      // Check event is emitted and tokens were moved correctly
      // Start position should be nth triangular number of i - 1
      await expect(tx)
        .to.emit(railgunLogic, 'GeneratedCommitmentBatch')
        .withArgs(
          0,
          ((i - 1) / 2) * i,
          commitmentPreimageMatcher(adjustedPreimages),
          encryptedRandomMatcher(encryptedRandoms),
        );
      await expect(tx).to.changeTokenBalances(
        testERC20,
        [primaryAccount.address, railgunLogic.address, treasuryAccount.address],
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
      randomBytes(16),
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

  it('Should transfer ERC20', async function () {
    const { railgunLogic, railgunLogicSnarkBypass, testERC20 } = await loadFixture(deploy);

    const prover = process.env.LONG_TESTS === 'no' ? dummyTransact : transact;
    const railgunContract =
      process.env.LONG_TESTS === 'no' ? railgunLogicSnarkBypass : railgunLogic;

    // Create random keys
    const viewingKey = edBabyJubJub.genRandomPrivateKey();
    const spendingKey = edBabyJubJub.genRandomPrivateKey();

    // Get token data
    const tokenData = {
      tokenType: TokenType.ERC20,
      tokenAddress: testERC20.address,
      tokenSubID: 0n,
    };

    // Create merkle tree and wallet
    const merkletree = await MerkleTree.createTree();
    const wallet = new Wallet(spendingKey, viewingKey);
    wallet.tokens.push(tokenData);

    // Number of notes to create at the start
    const initialDepositCount = 50;

    // Create deposit notes
    const depositNotes = new Array(initialDepositCount)
      .fill(0)
      .map(
        () => new Note(spendingKey, viewingKey, 100n * 10n ** 18n, randomBytes(16), tokenData, ''),
      );

    // Get preimages
    const depositPreimages = await Promise.all(
      depositNotes.map((note) => note.getCommitmentPreimage()),
    );

    // Get encrypted randoms
    const depositEncryptedRandoms = depositNotes.map((note) => note.encryptedRandom);

    // Deposit
    const depositTX = await railgunContract.generateDeposit(
      depositPreimages,
      depositEncryptedRandoms,
    );

    // Scan deposit
    await merkletree.scanTX(depositTX, railgunContract);
    await wallet.scanTX(depositTX, railgunContract);

    // Track starting position of tree
    let startPosition = initialDepositCount;

    // Loop through each circuit
    for (const artifactConfig of availableArtifacts()) {
      // Get test notes
      const notes = await wallet.getTestTransactionInputs(
        merkletree,
        artifactConfig.nullifiers,
        artifactConfig.commitments,
        false,
        tokenData,
      );

      // Get note hashes
      const hashes = await Promise.all(notes.outputs.map((note) => note.getHash()));

      // Get transaction inputs
      const transactionInputs = await prover(
        merkletree,
        WithdrawType.NONE,
        ethers.constants.AddressZero,
        new Uint8Array(32),
        notes.inputs,
        notes.outputs,
        ethers.constants.AddressZero,
      );

      // Should fail if ciphertext length doesn't match commitment length
      transactionInputs.boundParams.commitmentCiphertext.push(
        transactionInputs.boundParams.commitmentCiphertext[0],
      );

      await expect(railgunLogicSnarkBypass.transact([transactionInputs])).to.be.revertedWith(
        'RailgunLogic: Ciphertext and commitments count mismatch',
      );

      transactionInputs.boundParams.commitmentCiphertext.pop();

      // Should fail if SNARK proof isn't valid
      await expect(
        railgunLogic.transact([
          {
            proof: {
              a: {
                x: transactionInputs.proof.c.x,
                y: transactionInputs.proof.c.y,
              },
              b: transactionInputs.proof.b,
              c: {
                x: transactionInputs.proof.a.x,
                y: transactionInputs.proof.a.y,
              },
            },
            merkleRoot: transactionInputs.merkleRoot,
            nullifiers: transactionInputs.nullifiers,
            commitments: transactionInputs.commitments,
            boundParams: transactionInputs.boundParams,
            withdrawPreimage: transactionInputs.withdrawPreimage,
            overrideOutput: transactionInputs.overrideOutput,
          },
        ]),
      ).to.be.revertedWith('RailgunLogic: Invalid SNARK proof');

      // Should fail if merkle root is invalid
      await expect(
        railgunLogicSnarkBypass.transact([
          {
            proof: transactionInputs.proof,
            merkleRoot: new Uint8Array(32),
            nullifiers: transactionInputs.nullifiers,
            commitments: transactionInputs.commitments,
            boundParams: transactionInputs.boundParams,
            withdrawPreimage: transactionInputs.withdrawPreimage,
            overrideOutput: transactionInputs.overrideOutput,
          },
        ]),
      ).to.be.revertedWith('RailgunLogic: Invalid Merkle Root');

      // Transact
      const transaction = await railgunContract.transact([transactionInputs]);

      // Check transaction events
      await expect(transaction)
        .to.emit(railgunContract, 'Nullifiers')
        .withArgs(0, nullifiersMatcher(transactionInputs.nullifiers));
      await expect(transaction)
        .to.emit(railgunContract, 'CommitmentBatch')
        .withArgs(
          0,
          startPosition,
          hashesMatcher(hashes),
          ciphertextMatcher(transactionInputs.boundParams.commitmentCiphertext),
        );

      // Increment start position
      startPosition += notes.outputs.length;

      // Shouldn't be able to double spend
      await expect(railgunContract.transact([transactionInputs])).to.be.revertedWith(
        'RailgunLogic: Nullifier already seen',
      );

      // Scan transaction
      await merkletree.scanTX(transaction, railgunContract);
      await wallet.scanTX(transaction, railgunContract);

      // Get second test notes
      const notesAdaptLocked = await wallet.getTestTransactionInputs(
        merkletree,
        artifactConfig.nullifiers,
        artifactConfig.commitments,
        false,
        tokenData,
      );

      // Create transaction locked to dummy signer
      const transactionInputsAdaptLocked = await dummyTransact(
        merkletree,
        WithdrawType.NONE,
        await railgunLogicSnarkBypass.signer.getAddress(),
        new Uint8Array(32),
        notesAdaptLocked.inputs,
        notesAdaptLocked.outputs,
        ethers.constants.AddressZero,
      );

      // Shouldn't be able to submit from another address
      await expect(railgunLogic.transact([transactionInputsAdaptLocked])).to.be.revertedWith(
        "AdaptID doesn't match caller contract",
      );

      // Transaction from specified adapt locked address should succeed
      const transaction2 = await railgunLogicSnarkBypass.transact([transactionInputsAdaptLocked]);
      await expect(transaction2.wait()).to.be.fulfilled;

      // Scan transaction
      await merkletree.scanTX(transaction2, railgunContract);
      await wallet.scanTX(transaction2, railgunContract);

      // Increment start position
      startPosition += notes.outputs.length;
    }
  });

  it('Should withdraw ERC20', async function () {
    const {
      railgunLogic,
      railgunLogicSnarkBypass,
      primaryAccount,
      secondaryAccount,
      treasuryAccount,
      testERC20,
    } = await loadFixture(deploy);

    // Create random keys
    const viewingKey = edBabyJubJub.genRandomPrivateKey();
    const spendingKey = edBabyJubJub.genRandomPrivateKey();

    // Retrieve withdraw fee
    const withdrawFeeBP = (await railgunLogicSnarkBypass.withdrawFee()).toBigInt();

    // Get token data
    const tokenData = {
      tokenType: TokenType.ERC20,
      tokenAddress: testERC20.address,
      tokenSubID: 0n,
    };

    // Create merkle tree and wallet
    const merkletree = await MerkleTree.createTree();
    const wallet = new Wallet(spendingKey, viewingKey);
    wallet.tokens.push(tokenData);

    // Number of notes to create at the start
    const initialDepositCount = 50;

    // Create deposit notes
    const depositNotes = new Array(initialDepositCount)
      .fill(0)
      .map(
        () => new Note(spendingKey, viewingKey, 100n * 10n ** 18n, randomBytes(16), tokenData, ''),
      );

    // Get preimages
    const depositPreimages = await Promise.all(
      depositNotes.map((note) => note.getCommitmentPreimage()),
    );

    // Get encrypted randoms
    const depositEncryptedRandoms = depositNotes.map((note) => note.encryptedRandom);

    // Deposit
    const depositTX = await railgunLogicSnarkBypass.generateDeposit(
      depositPreimages,
      depositEncryptedRandoms,
    );

    // Scan deposit
    await merkletree.scanTX(depositTX, railgunLogicSnarkBypass);
    await wallet.scanTX(depositTX, railgunLogicSnarkBypass);

    // Track starting position of tree
    let startPosition = initialDepositCount;

    // Loop through each circuit
    for (const artifactConfig of availableArtifacts()) {
      // Get test notes
      const notes = await wallet.getTestTransactionInputs(
        merkletree,
        artifactConfig.nullifiers,
        artifactConfig.commitments,
        primaryAccount.address,
        tokenData,
      );

      // Get total value of withdraw
      const total = notes.outputs[notes.outputs.length - 1].value;

      // Get fees
      const { base, fee } = getFee(total, true, withdrawFeeBP);

      // Get note hashes
      const hashes = await Promise.all(notes.outputs.map((note) => note.getHash()));
      hashes.pop();

      // Get transaction inputs
      const transactionInputs = await dummyTransact(
        merkletree,
        WithdrawType.WITHDRAW,
        ethers.constants.AddressZero,
        new Uint8Array(32),
        notes.inputs,
        notes.outputs,
        ethers.constants.AddressZero,
      );

      // Should fail if ciphertext length doesn't match commitment length
      transactionInputs.boundParams.commitmentCiphertext.push(
        transactionInputs.boundParams.commitmentCiphertext[0],
      );

      await expect(railgunLogicSnarkBypass.transact([transactionInputs])).to.be.revertedWith(
        'RailgunLogic: Ciphertext and commitments count mismatch',
      );

      transactionInputs.boundParams.commitmentCiphertext.pop();

      // Should not be able to override if flag isn't set
      await expect(
        railgunLogicSnarkBypass.transact([
          {
            proof: transactionInputs.proof,
            merkleRoot: transactionInputs.merkleRoot,
            nullifiers: transactionInputs.nullifiers,
            commitments: transactionInputs.commitments,
            boundParams: transactionInputs.boundParams,
            withdrawPreimage: transactionInputs.withdrawPreimage,
            overrideOutput: secondaryAccount.address,
          },
        ]),
      ).to.be.revertedWith("RailgunLogic: Can't override destination address");

      // Should fail if withdraw preimage has been modified
      await expect(
        railgunLogicSnarkBypass.transact([
          {
            proof: transactionInputs.proof,
            merkleRoot: transactionInputs.merkleRoot,
            nullifiers: transactionInputs.nullifiers,
            commitments: transactionInputs.commitments,
            boundParams: transactionInputs.boundParams,
            withdrawPreimage: {
              npk: transactionInputs.withdrawPreimage.npk,
              token: transactionInputs.withdrawPreimage.token,
              value: transactionInputs.withdrawPreimage.value * 2n,
            },
            overrideOutput: secondaryAccount.address,
          },
        ]),
      ).to.be.revertedWith('RailgunLogic: Withdraw commitment preimage is invalid');

      // Withdraw
      const withdrawTX = await railgunLogicSnarkBypass.transact([transactionInputs]);

      // Check event is emitted and tokens were moved correctly
      await expect(withdrawTX)
        .to.emit(railgunLogicSnarkBypass, 'Nullifiers')
        .withArgs(0, nullifiersMatcher(transactionInputs.nullifiers));

      await expect(withdrawTX)
        .to.emit(railgunLogicSnarkBypass, 'CommitmentBatch')
        .withArgs(
          0,
          startPosition,
          hashesMatcher(hashes),
          ciphertextMatcher(transactionInputs.boundParams.commitmentCiphertext),
        );

      await expect(withdrawTX)
        .to.emit(railgunLogicSnarkBypass, 'Withdraw')
        .withArgs(
          ethers.utils.getAddress(
            arrayToHexString(transactionInputs.withdrawPreimage.npk.slice(12, 32), true),
          ),
          tokenDataMatcher(tokenData),
          base,
          fee,
        );

      await expect(withdrawTX).to.changeTokenBalances(
        testERC20,
        [primaryAccount.address, railgunLogicSnarkBypass.address, treasuryAccount.address],
        [base, -total, fee],
      );

      // Scan transaction
      await merkletree.scanTX(withdrawTX, railgunLogicSnarkBypass);
      await wallet.scanTX(withdrawTX, railgunLogicSnarkBypass);

      // Increment start position
      startPosition += notes.outputs.length - 1;
    }

    if (process.env.LONG_TESTS !== 'no') {
      // Loop through each circuit again
      for (const artifactConfig of availableArtifacts()) {
        // Get test notes
        const notes = await wallet.getTestTransactionInputs(
          merkletree,
          artifactConfig.nullifiers,
          artifactConfig.commitments,
          primaryAccount.address,
          tokenData,
        );

        // Get total value of withdraw
        const total = notes.outputs[notes.outputs.length - 1].value;

        // Get fees
        const { base, fee } = getFee(total, true, withdrawFeeBP);

        // Get note hashes
        const hashes = await Promise.all(notes.outputs.map((note) => note.getHash()));
        hashes.pop();

        // Get transaction inputs
        const transactionInputs = await transact(
          merkletree,
          WithdrawType.REDIRECT,
          ethers.constants.AddressZero,
          new Uint8Array(32),
          notes.inputs,
          notes.outputs,
          secondaryAccount.address,
        );

        // Shouldn't be able to redirect if original withdraw address isn't the submitter
        await expect(railgunLogicSnarkBypass.transact([transactionInputs])).to.be.revertedWith(
          "RailgunLogic: Can't override destination address",
        );

        // Withdraw
        const withdrawTX = await railgunLogic.transact([transactionInputs]);

        // Check event is emitted and tokens were moved correctly
        await expect(withdrawTX)
          .to.emit(railgunLogic, 'Nullifiers')
          .withArgs(0, nullifiersMatcher(transactionInputs.nullifiers));

        await expect(withdrawTX)
          .to.emit(railgunLogic, 'CommitmentBatch')
          .withArgs(
            0,
            startPosition,
            hashesMatcher(hashes),
            ciphertextMatcher(transactionInputs.boundParams.commitmentCiphertext),
          );

        await expect(withdrawTX)
          .to.emit(railgunLogicSnarkBypass, 'Withdraw')
          .withArgs(secondaryAccount.address, tokenDataMatcher(tokenData), base, fee);

        await expect(withdrawTX).to.changeTokenBalances(
          testERC20,
          [secondaryAccount.address, railgunLogic.address, treasuryAccount.address],
          [base, -total, fee],
        );

        // Scan transaction
        await merkletree.scanTX(withdrawTX, railgunLogic);
        await wallet.scanTX(withdrawTX, railgunLogic);

        // Increment start position
        startPosition += notes.outputs.length - 1;
      }
    }
  });
});
