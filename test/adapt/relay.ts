import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  loadFixture,
  setBalance,
  impersonateAccount,
} from '@nomicfoundation/hardhat-network-helpers';

import * as weth9artifact from '../../externalArtifacts/WETH9.json';

import { getAdaptParams, transactWithAdaptParams } from '../../helpers/adapt/relay';
import { loadArtifacts, listArtifacts } from '../../helpers/logic/artifacts';
import { dummyTransact, UnshieldType } from '../../helpers/logic/transaction';
import { MerkleTree } from '../../helpers/logic/merkletree';
import { Wallet } from '../../helpers/logic/wallet';
import { Note, TokenType } from '../../helpers/logic/note';
import { randomBytes } from '../../helpers/global/crypto';
import {
  arrayToBigInt,
  arrayToHexString,
  fromUTF8String,
  hexStringToArray,
} from '../../helpers/global/bytes';

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
      0,
      0,
      0,
      adminAccount.address,
    );

    // Deploy WETH9
    const WETH9 = new ethers.ContractFactory(
      weth9artifact.abi,
      weth9artifact.bytecode,
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
    await loadArtifacts(railgunSmartWalletAdmin, listArtifacts());

    // Deploy test ERC20 and approve for shield
    const TestERC20 = await ethers.getContractFactory('TestERC20');

    // Deploy a bunch of tokens to use as distribution tokens
    const testERC20Tokens = await Promise.all(
      Array(12)
        .fill(1)
        .map(() => TestERC20.deploy()),
    );

    // Connect tokens to bypass signer
    const testERC20TokensBypassSigner = testERC20Tokens.map((token) =>
      token.connect(snarkBypassSigner),
    );

    // Mint and approve for shield
    await Promise.all(
      testERC20Tokens.map(async (token) => {
        await token.mint(await token.signer.getAddress(), 2n ** 128n - 1n);
        await token.approve(railgunSmartWallet.address, 2n ** 256n - 1n);
      }),
    );
    await Promise.all(
      testERC20TokensBypassSigner.map(async (token) => {
        await token.mint(await token.signer.getAddress(), 2n ** 128n - 1n);
        await token.approve(railgunSmartWallet.address, 2n ** 256n - 1n);
      }),
    );

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
      relayAdapt,
      relayAdaptSnarkBypass,
      relayAdaptAdmin,
      testERC20Tokens,
      testERC20TokensBypassSigner,
      testERC721,
      testERC721BypassSigner,
      weth9,
    };
  }

  it('Should calculate adapt parameters', async function () {
    this.timeout(5 * 60 * 60 * 1000);
    const loops = process.env.SKIP_LONG_TESTS ? 5n : 10n;

    const { chainID, relayAdapt } = await loadFixture(deploy);

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
              chainID,
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
    const { relayAdapt, railgunSmartWallet, testERC20Tokens } = await loadFixture(deploy);

    // Check shielding specific amounts works

    // Mint test tokens to relayAdapt
    await testERC20Tokens[0].mint(relayAdapt.address, 10n ** 18n);

    // Create deposit note
    const depositNote = new Note(
      randomBytes(32),
      randomBytes(32),
      10n ** 18n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC20,
        tokenAddress: testERC20Tokens[0].address,
        tokenSubID: 0n,
      },
      '',
    );

    // Get shield request
    const shieldRequest = await depositNote.encryptForShield();

    // Shield
    const shieldTransaction = await relayAdapt.shield([shieldRequest]);

    // Check tokens moved
    await expect(shieldTransaction).to.changeTokenBalances(
      testERC20Tokens[0],
      [relayAdapt.address, railgunSmartWallet.address],
      [-(10n ** 18n), 10n ** 18n],
    );

    // Mint test tokens to relayAdapt
    await testERC20Tokens[0].mint(relayAdapt.address, 2n * 10n ** 18n);

    // Check shielding entire balance works

    // Create deposit note with 0 value
    const depositNoteAll = new Note(
      randomBytes(32),
      randomBytes(32),
      0n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC20,
        tokenAddress: testERC20Tokens[0].address,
        tokenSubID: 0n,
      },
      '',
    );

    // Get shield request
    const shieldRequestAll = await depositNoteAll.encryptForShield();

    // Shield
    const shieldTransactionAll = await relayAdapt.shield([shieldRequestAll]);

    // Check tokens moved
    await expect(shieldTransactionAll).to.changeTokenBalances(
      testERC20Tokens[0],
      [relayAdapt.address, railgunSmartWallet.address],
      [-(2n * 10n ** 18n), 2n * 10n ** 18n],
    );
  });

  it('Should no-op if no tokens to shield', async () => {
    const { relayAdapt, railgunSmartWallet, testERC20Tokens } = await loadFixture(deploy);

    // Create merkle tree
    const merkletree = await MerkleTree.createTree();

    // Create deposit note
    const depositNote = new Note(
      randomBytes(32),
      randomBytes(32),
      0n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC20,
        tokenAddress: testERC20Tokens[0].address,
        tokenSubID: 0n,
      },
      '',
    );

    // Get shield request
    const shieldRequest = await depositNote.encryptForShield();

    // Shield
    await relayAdapt.shield([shieldRequest, shieldRequest, shieldRequest]);

    // No additions to the merkle tree should have been made
    expect(await railgunSmartWallet.nextLeafIndex()).to.equal(0);
    expect(await railgunSmartWallet.merkleRoot()).to.equal(arrayToHexString(merkletree.root, true));

    // Transfer tokens to contract
    await testERC20Tokens[1].mint(relayAdapt.address, 10n ** 18n);

    // Create deposit note for second token
    const depositNote2 = new Note(
      randomBytes(32),
      randomBytes(32),
      10n ** 18n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC20,
        tokenAddress: testERC20Tokens[1].address,
        tokenSubID: 0n,
      },
      '',
    );

    // Get shield request
    const shieldRequest2 = await depositNote2.encryptForShield();

    // Shield
    await relayAdapt.shield([shieldRequest, shieldRequest2]);

    // Only non no-op tokens should be shielded
    await merkletree.insertLeaves([await depositNote2.getHash()], 0);

    // Check only non no-op tokens were added to tree
    expect(await railgunSmartWallet.nextLeafIndex()).to.equal(1);
    expect(await railgunSmartWallet.merkleRoot()).to.equal(arrayToHexString(merkletree.root, true));
  });

  it('Should deposit ERC721', async () => {
    const { relayAdapt, railgunSmartWallet, testERC721 } = await loadFixture(deploy);

    // Mint ERC721 to relay adapt
    await testERC721.mint(relayAdapt.address, 10n);

    // Create deposit note
    const depositNote = new Note(
      randomBytes(32),
      randomBytes(32),
      10n ** 18n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC721,
        tokenAddress: testERC721.address,
        tokenSubID: 10n,
      },
      '',
    );

    // Get shield request
    const shieldRequest = await depositNote.encryptForShield();

    // Shield
    await relayAdapt.shield([shieldRequest]);

    // Check tokens moved
    expect(await testERC721.ownerOf(10n)).to.equal(railgunSmartWallet.address);
  });

  it('Should fail on ERC1155', async () => {
    const { relayAdapt } = await loadFixture(deploy);

    // Create deposit note
    const depositNote = new Note(
      randomBytes(32),
      randomBytes(32),
      10n ** 18n,
      randomBytes(16),
      {
        tokenType: TokenType.ERC1155,
        tokenAddress: arrayToHexString(randomBytes(20), true),
        tokenSubID: 10n,
      },
      '',
    );

    // Get shield request
    const shieldRequest = await depositNote.encryptForShield();

    // Shield
    await expect(relayAdapt.shield([shieldRequest])).to.be.revertedWith(
      'RelayAdapt: ERC1155 not yet supported',
    );
  });

  it('Should transfer tokens', async () => {
    const { primaryAccount, relayAdapt, testERC20Tokens, testERC721 } = await loadFixture(deploy);

    // Mint ETH to relayAdapt
    await setBalance(relayAdapt.address, '0x01F4');

    // Mint test ERC20 tokens to relayAdapt
    await testERC20Tokens[0].mint(relayAdapt.address, 2n * 10n ** 18n);
    await testERC20Tokens[1].mint(relayAdapt.address, 2n * 10n ** 18n);

    // Mint test ERC721 tokens to relayAdapt
    await testERC721.mint(relayAdapt.address, 10n);

    // Transfer tokens
    const transferTX = await relayAdapt.transfer([
      {
        to: primaryAccount.address,
        value: 100n,
        token: {
          tokenType: TokenType.ERC20,
          tokenAddress: ethers.constants.AddressZero,
          tokenSubID: 0n,
        },
      },
      {
        to: primaryAccount.address,
        value: 0n,
        token: {
          tokenType: TokenType.ERC20,
          tokenAddress: ethers.constants.AddressZero,
          tokenSubID: 0n,
        },
      },
      {
        to: primaryAccount.address,
        value: 10n ** 18n,
        token: {
          tokenType: TokenType.ERC20,
          tokenAddress: testERC20Tokens[0].address,
          tokenSubID: 0n,
        },
      },
      {
        to: primaryAccount.address,
        value: 0n,
        token: {
          tokenType: TokenType.ERC20,
          tokenAddress: testERC20Tokens[1].address,
          tokenSubID: 0n,
        },
      },
      {
        to: primaryAccount.address,
        value: 0n,
        token: {
          tokenType: TokenType.ERC721,
          tokenAddress: testERC721.address,
          tokenSubID: 10n,
        },
      },
    ]);

    // Check tokens transferred
    await expect(transferTX).to.changeEtherBalances(
      [relayAdapt.address, primaryAccount.address],
      [-500, 500],
    );

    await expect(transferTX).to.changeTokenBalances(
      testERC20Tokens[0],
      [relayAdapt.address, primaryAccount.address],
      [-(10n ** 18n), 10n ** 18n],
    );

    await expect(transferTX).to.changeTokenBalances(
      testERC20Tokens[1],
      [relayAdapt.address, primaryAccount.address],
      [-(2n * 10n ** 18n), 2n * 10n ** 18n],
    );

    expect(await testERC721.ownerOf(10n)).to.equal(primaryAccount.address);

    // ERC1155 should revert
    await expect(
      relayAdapt.transfer([
        {
          to: primaryAccount.address,
          value: 10n ** 18n,
          token: {
            tokenType: TokenType.ERC1155,
            tokenAddress: testERC20Tokens[0].address,
            tokenSubID: 0n,
          },
        },
      ]),
    ).to.be.revertedWith('RelayAdapt: ERC1155 not yet supported');

    // Deploy contract that will revert on ETH received
    const GovernanceTargetAlphaStub = await ethers.getContractFactory('GovernanceTargetAlphaStub');
    const governanceTargetAlphaStub = await GovernanceTargetAlphaStub.deploy();

    // Mint ETH to relayAdapt
    await setBalance(relayAdapt.address, '0x01F4');

    // Should throw if ETH transfer fails
    await expect(
      relayAdapt.transfer([
        {
          to: governanceTargetAlphaStub.address,
          value: 0n,
          token: {
            tokenType: TokenType.ERC20,
            tokenAddress: ethers.constants.AddressZero,
            tokenSubID: 0n,
          },
        },
      ]),
    ).to.be.revertedWith('RelayAdapt: ETH transfer failed');
  });

  it('Should wrap and unwrap ETH', async () => {
    const { relayAdapt, weth9 } = await loadFixture(deploy);

    // Mint ETH to relayAdapt
    await setBalance(relayAdapt.address, '0x01F4');

    // Wrap
    const wrapTX = relayAdapt.wrapBase(100);

    await expect(wrapTX).to.changeEtherBalances([relayAdapt.address, weth9.address], [-100, 100]);
    await expect(wrapTX).to.changeTokenBalance(weth9, relayAdapt.address, 100);

    // Unwrap
    const unwrapTX = relayAdapt.unwrapBase(100);

    await expect(unwrapTX).to.changeEtherBalances([relayAdapt.address, weth9.address], [100, -100]);
    await expect(unwrapTX).to.changeTokenBalance(weth9, relayAdapt.address, -100);

    // Wrap all
    const wrapAllTX = relayAdapt.wrapBase(0);

    await expect(wrapAllTX).to.changeEtherBalances(
      [relayAdapt.address, weth9.address],
      [-500, 500],
    );
    await expect(wrapAllTX).to.changeTokenBalance(weth9, relayAdapt.address, 500);

    // Unwrap all
    const unwrapAllTX = relayAdapt.unwrapBase(0);

    await expect(unwrapAllTX).to.changeEtherBalances(
      [relayAdapt.address, weth9.address],
      [500, -500],
    );
    await expect(unwrapAllTX).to.changeTokenBalance(weth9, relayAdapt.address, -500);
  });

  it('Should multicall', async () => {
    const { primaryAccount, relayAdapt, testERC20Tokens, railgunSmartWallet } = await loadFixture(
      deploy,
    );

    // Deploy multicall target
    const GovernanceStateChangeTargetStub = await ethers.getContractFactory(
      'GovernanceStateChangeTargetStub',
    );
    const governanceStateChangeTargetStub = await GovernanceStateChangeTargetStub.deploy('hello');

    // Deploy contract that will revert on ETH received
    const GovernanceTargetAlphaStub = await ethers.getContractFactory('GovernanceTargetAlphaStub');
    const governanceTargetAlphaStub = await GovernanceTargetAlphaStub.deploy();

    // Should call external contract
    await relayAdapt.multicall(false, [
      {
        to: governanceStateChangeTargetStub.address,
        data: governanceStateChangeTargetStub.interface.encodeFunctionData('changeGreeting', [
          'hi',
        ]),
        value: 0n,
      },
    ]);

    expect(await governanceStateChangeTargetStub.greeting()).to.equal('hi');

    // Mint ERC20 tokens
    await testERC20Tokens[0].mint(relayAdapt.address, 10n ** 18n);

    // Should call internal contract
    await expect(
      relayAdapt.multicall(true, [
        {
          to: relayAdapt.address,
          data: relayAdapt.interface.encodeFunctionData('transfer', [
            [
              {
                to: primaryAccount.address,
                value: 10n ** 18n,
                token: {
                  tokenType: TokenType.ERC20,
                  tokenAddress: testERC20Tokens[0].address,
                  tokenSubID: 0n,
                },
              },
            ],
          ]),
          value: 0n,
        },
      ]),
    ).to.changeTokenBalances(
      testERC20Tokens[0],
      [relayAdapt.address, primaryAccount.address],
      [-(10n ** 18n), 10n ** 18n],
    );

    // Should throw on external contract failure if require success is true
    await expect(
      relayAdapt.multicall(true, [
        {
          to: governanceTargetAlphaStub.address,
          data: governanceTargetAlphaStub.interface.encodeFunctionData('willRevert'),
          value: 0n,
        },
      ]),
    )
      .to.be.revertedWithCustomError(relayAdapt, 'CallFailed')
      .withArgs(
        0,
        `0x08c379a0${ethers.utils.defaultAbiCoder
          .encode(['bytes'], [fromUTF8String('1 is not equal to 2')])
          .slice(2)}`,
      );

    // Should not throw on external contract failure if require success is false
    await expect(
      relayAdapt.multicall(false, [
        {
          to: governanceTargetAlphaStub.address,
          data: governanceTargetAlphaStub.interface.encodeFunctionData('willRevert'),
          value: 0n,
        },
      ]),
    )
      .to.emit(relayAdapt, 'CallError')
      .withArgs(
        0,
        `0x08c379a0${ethers.utils.defaultAbiCoder
          .encode(['bytes'], [fromUTF8String('1 is not equal to 2')])
          .slice(2)}`,
      );

    const MaliciousReentrant = await ethers.getContractFactory('MaliciousReentrant');
    const maliciousReentrant = await MaliciousReentrant.deploy();

    // Should prevent reentrancy
    await expect(
      relayAdapt.multicall(true, [
        {
          to: maliciousReentrant.address,
          data: maliciousReentrant.interface.encodeFunctionData('attack'),
          value: 0n,
        },
      ]),
    ).to.eventually.be.fulfilled;

    // Should fail if call is to core contract
    await expect(
      relayAdapt.multicall(true, [
        {
          to: railgunSmartWallet.address,
          data: railgunSmartWallet.interface.encodeFunctionData('transact', [[]]),
          value: 0n,
        },
      ]),
    ).to.be.revertedWithCustomError(relayAdapt, 'CallFailed');
  });

  it('Should submit relay bundle', async () => {
    const { chainID, relayAdapt, relayAdaptSnarkBypass, railgunSmartWallet, testERC20Tokens } =
      await loadFixture(deploy);

    // Deploy multicall target
    const GovernanceStateChangeTargetStub = await ethers.getContractFactory(
      'GovernanceStateChangeTargetStub',
    );
    const governanceStateChangeTargetStub = await GovernanceStateChangeTargetStub.deploy('hello');

    // Create merkletree, wallet, and token data
    const merkletree = await MerkleTree.createTree();
    const wallet = new Wallet(randomBytes(32), randomBytes(32));

    const tokenData = {
      tokenType: TokenType.ERC20,
      tokenAddress: testERC20Tokens[0].address,
      tokenSubID: 0n,
    };

    // Shield tokens
    const shieldNotes = new Array(16)
      .fill(1)
      .map(
        () =>
          new Note(
            wallet.spendingKey,
            wallet.viewingKey,
            10n ** 18n,
            randomBytes(16),
            tokenData,
            '',
          ),
      );

    const depositTX = await railgunSmartWallet.shield(
      await Promise.all(shieldNotes.map((note) => note.encryptForShield())),
    );

    await merkletree.scanTX(depositTX, railgunSmartWallet);
    await wallet.scanTX(depositTX, railgunSmartWallet);

    // Generate transaction bundle and actions
    const notesInOut = await wallet.getTestTransactionInputs(
      merkletree,
      2,
      3,
      false,
      tokenData,
      wallet.spendingKey,
      wallet.viewingKey,
    );

    const actionData = {
      random: randomBytes(31),
      requireSuccess: false,
      minGasLimit: 10000000n,
      calls: [
        {
          to: governanceStateChangeTargetStub.address,
          data: hexStringToArray(
            governanceStateChangeTargetStub.interface.encodeFunctionData('changeGreeting', ['hi']),
          ),
          value: 0n,
        },
      ],
    };

    const transactionsWrongAdaptID = [
      await dummyTransact(
        merkletree,
        0n,
        UnshieldType.NONE,
        chainID,
        relayAdapt.address,
        new Uint8Array(32),
        notesInOut.inputs,
        notesInOut.outputs,
      ),
    ];

    const transactions = await transactWithAdaptParams(merkletree, actionData, [
      {
        minGasPrice: 0n,
        unshield: UnshieldType.NONE,
        chainID,
        adaptContract: relayAdapt.address,
        notesIn: notesInOut.inputs,
        notesOut: notesInOut.outputs,
      },
    ]);

    // Should reject if not enough gas is supplied
    await expect(
      relayAdapt.relay(transactions, actionData, { gasLimit: 5000000n }),
    ).to.be.revertedWith('RelayAdapt: Not enough gas supplied');

    // Should reject if wrong adapt params is supplied
    await expect(
      relayAdapt.relay(transactionsWrongAdaptID, actionData, { gasLimit: 11000000n }),
    ).to.be.revertedWith('RelayAdapt: AdaptID Parameters Mismatch');

    // Submit transaction
    const relayTX = await relayAdapt.relay(transactions, actionData, { gasLimit: 11000000n });

    // Check effects have been applied
    expect(await governanceStateChangeTargetStub.greeting()).to.equal('hi');

    await merkletree.scanTX(relayTX, railgunSmartWallet);
    await wallet.scanTX(relayTX, railgunSmartWallet);

    // Verification bypass address shouldn't revert
    // Generate transaction bundle and actions
    const notesInOutSnarkBypass = await wallet.getTestTransactionInputs(
      merkletree,
      2,
      3,
      false,
      tokenData,
      wallet.spendingKey,
      wallet.viewingKey,
    );

    const actionDataNoOp = {
      random: randomBytes(31),
      requireSuccess: false,
      minGasLimit: 0n,
      calls: [],
    };

    const transactionsSnarkBypass = [
      await dummyTransact(
        merkletree,
        0n,
        UnshieldType.NONE,
        chainID,
        relayAdapt.address,
        new Uint8Array(32),
        notesInOutSnarkBypass.inputs,
        notesInOutSnarkBypass.outputs,
      ),
    ];

    await expect(relayAdaptSnarkBypass.relay(transactionsSnarkBypass, actionDataNoOp)).to.eventually
      .be.fulfilled;
  });
});
