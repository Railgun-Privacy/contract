import { ethers, network } from 'hardhat';
import { expect } from 'chai';
import {
  loadFixture,
  setBalance,
  impersonateAccount,
} from '@nomicfoundation/hardhat-network-helpers';

import * as weth9artifact from '../../externalArtifacts/WETH9.json';

import { transactWithAdaptParams } from '../../helpers/adapt/relay';
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

describe('Adapt/RelayAdapt7702', () => {
  const EXECUTE_SIGNATURE = 'execute((((uint256,uint256),(uint256[2],uint256[2]),(uint256,uint256)),bytes32,bytes32[],bytes32[],(uint16,uint72,uint8,uint64,address,bytes32,(bytes32[4],bytes32,bytes32,bytes,bytes)[]),(bytes32,(uint8,address,uint256),uint120))[],(bool,uint256,(address,bytes,uint256)[]),bytes)';
  const ZERO_ADAPT_PARAMS = arrayToHexString(new Uint8Array(32), true);

  const serializeTokenData = (token: {
    tokenType: number;
    tokenAddress: string;
    tokenSubID: bigint;
  }) => [token.tokenType, token.tokenAddress, token.tokenSubID];

  const serializeCommitmentPreimage = (preimage: {
    npk: Uint8Array | string;
    token: {
      tokenType: number;
      tokenAddress: string;
      tokenSubID: bigint;
    };
    value: bigint;
  }) => [
    typeof preimage.npk === 'string'
      ? preimage.npk
      : arrayToHexString(preimage.npk, true),
    serializeTokenData(preimage.token),
    preimage.value,
  ];

  const serializeCommitmentCiphertext = (ciphertext: {
    ciphertext: [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
    blindedSenderViewingKey: Uint8Array;
    blindedReceiverViewingKey: Uint8Array;
    annotationData: Uint8Array;
    memo: Uint8Array;
  }) => [
    ciphertext.ciphertext.map((value) => arrayToHexString(value, true)),
    arrayToHexString(ciphertext.blindedSenderViewingKey, true),
    arrayToHexString(ciphertext.blindedReceiverViewingKey, true),
    arrayToHexString(ciphertext.annotationData, true),
    arrayToHexString(ciphertext.memo, true),
  ];

  const serializeTransaction = (transaction: any) => [
    [
      [transaction.proof.a.x, transaction.proof.a.y],
      [transaction.proof.b.x, transaction.proof.b.y],
      [transaction.proof.c.x, transaction.proof.c.y],
    ],
    transaction.merkleRoot,
    transaction.nullifiers,
    transaction.commitments,
    [
      transaction.boundParams.treeNumber,
      transaction.boundParams.minGasPrice,
      transaction.boundParams.unshield,
      transaction.boundParams.chainID,
      transaction.boundParams.adaptContract,
      transaction.boundParams.adaptParams,
      transaction.boundParams.commitmentCiphertext.map(serializeCommitmentCiphertext),
    ],
    serializeCommitmentPreimage(transaction.unshieldPreimage),
  ];

  const serializeCall = (call: { to: string; data: string | Uint8Array; value: bigint }) => [
    call.to,
    typeof call.data === 'string' ? call.data : arrayToHexString(call.data, true),
    call.value,
  ];

  const serializeActionData = (actionData: {
    requireSuccess: boolean;
    minGasLimit: bigint;
    calls: { to: string; data: string | Uint8Array; value: bigint }[];
  }) => [
    actionData.requireSuccess,
    actionData.minGasLimit,
    actionData.calls.map(serializeCall),
  ];

  const serializeShieldRequest = (shieldRequest: any) => [
    serializeCommitmentPreimage(shieldRequest.preimage),
    [
      shieldRequest.ciphertext.encryptedBundle.map((value: Uint8Array) =>
        arrayToHexString(value, true),
      ),
      arrayToHexString(shieldRequest.ciphertext.shieldKey, true),
    ],
  ];

  const serializeTokenTransfer = (transfer: any) => [
    serializeTokenData(transfer.token),
    transfer.to,
    transfer.value,
  ];

  const encodeRelayAdaptFunctionData = (
    relayAdapt7702: any,
    functionName: string,
    args: any[],
  ) => (relayAdapt7702.interface as any).encodeFunctionData(functionName, args);

  const executeRelayAdapt = (
    relayAdapt7702: any,
    transactions: any[],
    actionData: any,
    signature: string,
    overrides?: any,
  ) => {
    if (overrides) {
      return relayAdapt7702[EXECUTE_SIGNATURE](transactions, actionData, signature, overrides);
    }

    return relayAdapt7702[EXECUTE_SIGNATURE](transactions, actionData, signature);
  };

  const getRelayAdapt7702Signature = async (
    signer: any,
    chainID: bigint,
    transactions: any[],
    actionData: any,
  ) => {
    const domain = {
      name: 'RelayAdapt7702',
      version: '1',
      chainId: chainID,
      verifyingContract: signer.address,
    };

    const types = {
      Execute: [
        { name: 'payloadHash', type: 'bytes32' },
      ],
    };

    const value = {
      payloadHash: ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          [
            'tuple(((uint256,uint256),(uint256[2],uint256[2]),(uint256,uint256)),bytes32,bytes32[],bytes32[],(uint16,uint72,uint8,uint64,address,bytes32,tuple(bytes32[4],bytes32,bytes32,bytes,bytes)[]),(bytes32,(uint8,address,uint256),uint120))[]',
            'tuple(bool,uint256,tuple(address,bytes,uint256)[])',
          ],
          [transactions.map(serializeTransaction), serializeActionData(actionData)],
        ),
      ),
    };

    return signer._signTypedData(domain, types, value);
  };

  const getRelayAdapt7702MulticallSignature = async (
    signer: any,
    chainID: bigint,
    requireSuccess: boolean,
    calls: any[],
    nonce: bigint,
  ) => {
    const domain = {
      name: 'RelayAdapt7702',
      version: '1',
      chainId: chainID,
      verifyingContract: signer.address,
    };

    const types = {
      Multicall: [
        { name: 'payloadHash', type: 'bytes32' },
      ],
    };

    const value = {
      payloadHash: ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ['bool', 'tuple(address,bytes,uint256)[]', 'uint256'],
          [requireSuccess, calls.map(serializeCall), nonce],
        ),
      ),
    };

    return signer._signTypedData(domain, types, value);
  };

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

    // Get accounts
    // primary: Relayer
    // secondary: Ephemeral Account (User)
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

    // Deploy RailgunRegistry mock
    const RailgunRegistry = await ethers.getContractFactory('RailgunRegistry');
    const railgunRegistry = await RailgunRegistry.deploy(primaryAccount.address);
    await railgunRegistry.deployed();

    // Deploy RelayAdapt7702 Template directly
    const RelayAdapt7702 = await ethers.getContractFactory('RelayAdapt7702');
    const relayAdapt7702Template = await RelayAdapt7702.deploy(railgunSmartWallet.address, weth9.address);
    await relayAdapt7702Template.deployed();
    const relayAdapt7702Address = relayAdapt7702Template.address;
    console.log(`\nRelay Adapt 7702 deployed at ${relayAdapt7702Address}`);
    
    // Register the current RelayAdapt7702 in the mock registry
    await railgunRegistry.setContract('RelayAdapt7702', relayAdapt7702Address, 1);
    expect(await railgunRegistry.isMock()).to.equal(true);
    expect(await railgunRegistry.getContractAddress('RelayAdapt7702')).to.equal(relayAdapt7702Address);
    
    // --- EIP-7702 Simulation ---
    // Get the runtime bytecode (which has immutables set)
    const code = await ethers.provider.getCode(relayAdapt7702Template.address);

    // Set code of ephemeral account (secondaryAccount)
    // This simulates the state after an EIP-7702 authorization is active
    await network.provider.send('hardhat_setCode', [
        secondaryAccount.address,
        code,
    ]);
    
    // Create contract instance attached to ephemeral address
    const relayAdapt7702 = RelayAdapt7702.attach(secondaryAccount.address);

    // Get alternative signers
    const railgunSmartWalletSnarkBypass = railgunSmartWallet.connect(snarkBypassSigner);
    const railgunSmartWalletAdmin = railgunSmartWallet.connect(adminAccount);
    
    // Connect to the ephemeral account address, but using the Relayer (primaryAccount) as the caller
    const relayAdapt7702Relayer = relayAdapt7702.connect(primaryAccount);
    const relayAdapt7702Bypass = relayAdapt7702.connect(snarkBypassSigner);

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
      railgunSmartWallet,
      railgunSmartWalletSnarkBypass,
      relayAdapt7702,
      relayAdapt7702Relayer,
      relayAdapt7702Bypass,
      weth9,
      primaryAccount, // Relayer
      secondaryAccount, // Ephemeral User
      snarkBypassSigner,
      chainID,
      testERC20Tokens,
      testERC20TokensBypassSigner,
      testERC721,
      testERC721BypassSigner,
    };
  }

  it('Should execute a transaction with valid signature', async () => {
    const {
      railgunSmartWallet,
      relayAdapt7702Bypass,
      snarkBypassSigner,
      secondaryAccount,
      chainID,
    } = await loadFixture(deploy);

    // 1. Prepare Dummy Transaction
    const merkletree = await MerkleTree.createTree();
    const tokenData = {
        tokenType: TokenType.ERC20,
        tokenAddress: arrayToHexString(randomBytes(20), true),
        tokenSubID: 0n,
    };
    const notesIn = [new Note(randomBytes(32), randomBytes(32), 100n, randomBytes(16), tokenData, '')];
    const notesOut = [new Note(randomBytes(32), randomBytes(32), 100n, randomBytes(16), tokenData, '')];
    
    // Insert leaves so notesIn are valid
    await merkletree.insertLeaves(await Promise.all(notesIn.map((note) => note.getHash())), 0);
    
    // Whitelist the root in the contract
    await railgunSmartWallet.setMerkleRoot(0, merkletree.root, true);

    const transactions = [
      await dummyTransact(
        merkletree,
        BigInt(0), // minGasPrice
        UnshieldType.NONE,
        chainID,
        secondaryAccount.address, // adaptContract
        randomBytes(32), // adaptParams (will be overwritten)
        notesIn,
        notesOut,
      ),
    ];

    // 2. Prepare Action Data
    const actionData = {
      requireSuccess: true,
      minGasLimit: BigInt(10000),
      calls: [],
    };

    transactions[0].boundParams.adaptParams = new Uint8Array(32);
    const serializedTransactions = transactions.map(serializeTransaction);
    const serializedActionData = serializeActionData(actionData);

    // 4. Sign Payload
    const signature = await getRelayAdapt7702Signature(
      secondaryAccount,
      chainID,
      transactions,
      actionData,
    );

    // 5. Execute
    // Call from snarkBypassSigner (Relayer)
    await expect(
      executeRelayAdapt(relayAdapt7702Bypass as any, serializedTransactions, serializedActionData, signature),
    ).to.not.be.reverted;
  });

  it('Should revert execution with invalid signature (wrong signer)', async () => {
    const {
      railgunSmartWallet,
      relayAdapt7702Relayer,
      primaryAccount,
      chainID,
    } = await loadFixture(deploy);

    // 1. Prepare Dummy Transaction
    const merkletree = await MerkleTree.createTree();
    const tokenData = {
        tokenType: TokenType.ERC20,
        tokenAddress: arrayToHexString(randomBytes(20), true),
        tokenSubID: 0n,
    };
    const notesIn = [new Note(randomBytes(32), randomBytes(32), 100n, randomBytes(16), tokenData, '')];
    const notesOut = [new Note(randomBytes(32), randomBytes(32), 100n, randomBytes(16), tokenData, '')];
    
    // Insert leaves so notesIn are valid
    await merkletree.insertLeaves(await Promise.all(notesIn.map((note) => note.getHash())), 0);
    
    // Whitelist the root in the contract
    await railgunSmartWallet.setMerkleRoot(0, merkletree.root, true);

    const transactions = [
      await dummyTransact(
        merkletree,
        BigInt(0), // minGasPrice
        UnshieldType.NONE,
        chainID,
        ethers.constants.AddressZero, // adaptContract
        randomBytes(32), // adaptParams (will be overwritten)
        notesIn,
        notesOut,
      ),
    ];

    const actionData = {
      requireSuccess: true,
      minGasLimit: BigInt(10000),
      calls: [],
    };
    transactions[0].boundParams.adaptParams = new Uint8Array(32);
    const serializedTransactions = transactions.map(serializeTransaction);
    const serializedActionData = serializeActionData(actionData);

    // 4. Sign Payload with WRONG signer (primaryAccount instead of secondaryAccount)
    const signature = await getRelayAdapt7702Signature(
      primaryAccount,
      chainID,
      transactions,
      actionData,
    );

    // 5. Execute
    await expect(
      executeRelayAdapt(relayAdapt7702Relayer as any, serializedTransactions, serializedActionData, signature),
    ).to.be.revertedWith('RelayAdapt: Invalid signature');
  });

  it('Should revert direct calls to protected functions', async () => {
    const {
      relayAdapt7702Relayer,
    } = await loadFixture(deploy);

    // Try calling shield directly
    await expect(
        relayAdapt7702Relayer.shield([]),
    ).to.be.revertedWith('RelayAdapt: External call to onlySelf function');

    // Try calling transfer directly
    await expect(
        relayAdapt7702Relayer.transfer([]),
    ).to.be.revertedWith('RelayAdapt: External call to onlySelf function');
  });

  it('Should deposit ERC20', async () => {
    const { relayAdapt7702, relayAdapt7702Relayer, railgunSmartWallet, testERC20Tokens, secondaryAccount, primaryAccount, chainID } = await loadFixture(deploy);

    // Mint test tokens to relayAdapt (ephemeral account)
    await testERC20Tokens[0].mint(relayAdapt7702.address, 10n ** 18n);

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

    // Prepare Shield Call
    const shieldCall = {
        to: relayAdapt7702.address,
      data: encodeRelayAdaptFunctionData(relayAdapt7702, 'shield', [[serializeShieldRequest(shieldRequest)]]),
        value: 0n,
    };

    const actionData = {
        requireSuccess: true,
        minGasLimit: BigInt(10000),
        calls: [shieldCall],
    };

    // Sign Payload
    const signature = await getRelayAdapt7702Signature(
        secondaryAccount,
        chainID,
        [],
        actionData,
    );
    const serializedActionData = serializeActionData(actionData);

    // Execute Shield
    const shieldTransaction = await executeRelayAdapt(
      relayAdapt7702Relayer as any,
      [],
      serializedActionData,
      signature,
    );

    // Check tokens moved
    await expect(shieldTransaction).to.changeTokenBalances(
      testERC20Tokens[0],
      [relayAdapt7702.address, railgunSmartWallet.address],
      [-(10n ** 18n), 10n ** 18n],
    );
  });

  it('Should no-op if no tokens to shield', async () => {
    const { relayAdapt7702, relayAdapt7702Relayer, railgunSmartWallet, testERC20Tokens, secondaryAccount, primaryAccount, chainID } = await loadFixture(deploy);

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

    // Prepare Shield Call
    const shieldCall = {
        to: relayAdapt7702.address,
        data: encodeRelayAdaptFunctionData(relayAdapt7702, 'shield', [[
          serializeShieldRequest(shieldRequest),
          serializeShieldRequest(shieldRequest),
          serializeShieldRequest(shieldRequest),
        ]]),
        value: 0n,
    };

    const actionData = {
        requireSuccess: true,
        minGasLimit: BigInt(10000),
        calls: [shieldCall],
    };

    // Sign Payload
    const signature = await getRelayAdapt7702Signature(
        secondaryAccount,
        chainID,
        [],
        actionData,
    );
    const serializedActionData = serializeActionData(actionData);

    // Execute Shield
    await executeRelayAdapt(relayAdapt7702Relayer as any, [], serializedActionData, signature);

    // No additions to the merkle tree should have been made
    expect(await railgunSmartWallet.nextLeafIndex()).to.equal(0);
    expect(await railgunSmartWallet.merkleRoot()).to.equal(arrayToHexString(merkletree.root, true));
  });

  it('Should deposit ERC721', async () => {
    const { relayAdapt7702, relayAdapt7702Relayer, railgunSmartWallet, testERC721, secondaryAccount, primaryAccount, chainID } = await loadFixture(deploy);

    // Mint ERC721 to relay adapt (ephemeral account)
    await testERC721.mint(relayAdapt7702.address, 10n);

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

    // Prepare Shield Call
    const shieldCall = {
        to: relayAdapt7702.address,
      data: encodeRelayAdaptFunctionData(relayAdapt7702, 'shield', [[serializeShieldRequest(shieldRequest)]]),
        value: 0n,
    };

    const actionData = {
        requireSuccess: true,
        minGasLimit: BigInt(10000),
        calls: [shieldCall],
    };

    // Sign Payload
    const signature = await getRelayAdapt7702Signature(
        secondaryAccount,
        chainID,
        [],
        actionData,
    );
    const serializedActionData = serializeActionData(actionData);

    // Execute Shield
    await executeRelayAdapt(relayAdapt7702Relayer as any, [], serializedActionData, signature);

    // Check tokens moved
    expect(await testERC721.ownerOf(10n)).to.equal(railgunSmartWallet.address);
  });

  it('Should fail on ERC1155', async () => {
    const { relayAdapt7702, relayAdapt7702Relayer, testERC20Tokens, secondaryAccount, primaryAccount, chainID } = await loadFixture(deploy);

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

    // Prepare Shield Call
    const shieldCall = {
        to: relayAdapt7702.address,
      data: encodeRelayAdaptFunctionData(relayAdapt7702, 'shield', [[serializeShieldRequest(shieldRequest)]]),
        value: 0n,
    };

    const actionData = {
        requireSuccess: true,
        minGasLimit: BigInt(10000),
        calls: [shieldCall],
    };

    // Sign Payload
    const signature = await getRelayAdapt7702Signature(
        secondaryAccount,
        chainID,
        [],
        actionData,
    );
    const serializedActionData = serializeActionData(actionData);

    // Execute Shield
    await expect(
      executeRelayAdapt(relayAdapt7702Relayer as any, [], serializedActionData, signature)
    ).to.be.revertedWithCustomError(relayAdapt7702, 'CallFailed')
    .withArgs(
        0,
        `0x08c379a0${ethers.utils.defaultAbiCoder
          .encode(['bytes'], [fromUTF8String('RelayAdapt: ERC1155 not yet supported')])
          .slice(2)}`,
    );
  });

  it('Should transfer tokens', async () => {
    const { primaryAccount, secondaryAccount, relayAdapt7702, relayAdapt7702Relayer, testERC20Tokens, testERC721, chainID } = await loadFixture(deploy);

    // Mint ETH to relayAdapt (ephemeral account)
    await setBalance(relayAdapt7702.address, '0x01F4');

    // Mint test ERC20 tokens to relayAdapt
    await testERC20Tokens[0].mint(relayAdapt7702.address, 2n * 10n ** 18n);
    await testERC20Tokens[1].mint(relayAdapt7702.address, 2n * 10n ** 18n);

    // Mint test ERC721 tokens to relayAdapt
    await testERC721.mint(relayAdapt7702.address, 10n);

    // Prepare Transfer Call
    const transferCall = {
        to: relayAdapt7702.address,
      data: encodeRelayAdaptFunctionData(relayAdapt7702, 'transfer', [[
            serializeTokenTransfer({
                to: primaryAccount.address,
                value: 100n,
                token: {
                  tokenType: TokenType.ERC20,
                  tokenAddress: ethers.constants.AddressZero,
                  tokenSubID: 0n,
                },
            }),
            serializeTokenTransfer({
                to: primaryAccount.address,
                value: 0n,
                token: {
                  tokenType: TokenType.ERC20,
                  tokenAddress: ethers.constants.AddressZero,
                  tokenSubID: 0n,
                },
            }),
            serializeTokenTransfer({
                to: primaryAccount.address,
                value: 10n ** 18n,
                token: {
                  tokenType: TokenType.ERC20,
                  tokenAddress: testERC20Tokens[0].address,
                  tokenSubID: 0n,
                },
            }),
            serializeTokenTransfer({
                to: primaryAccount.address,
                value: 0n,
                token: {
                  tokenType: TokenType.ERC20,
                  tokenAddress: testERC20Tokens[1].address,
                  tokenSubID: 0n,
                },
            }),
            serializeTokenTransfer({
                to: primaryAccount.address,
                value: 0n,
                token: {
                  tokenType: TokenType.ERC721,
                  tokenAddress: testERC721.address,
                  tokenSubID: 10n,
                },
            }),
          ]]),
        value: 0n,
    };

    const actionData = {
        requireSuccess: true,
        minGasLimit: BigInt(10000),
        calls: [transferCall],
    };

    // Sign Payload
    const signature = await getRelayAdapt7702Signature(
        secondaryAccount,
        chainID,
        [],
        actionData,
    );
    const serializedActionData = serializeActionData(actionData);

    // Execute Transfer
    const transferTX = await executeRelayAdapt(
      relayAdapt7702Relayer as any,
      [],
      serializedActionData,
      signature,
    );

    // Check tokens transferred
    await expect(transferTX).to.changeEtherBalances(
      [relayAdapt7702.address, primaryAccount.address],
      [-500, 500],
    );

    await expect(transferTX).to.changeTokenBalances(
      testERC20Tokens[0],
      [relayAdapt7702.address, primaryAccount.address],
      [-(10n ** 18n), 10n ** 18n],
    );

    await expect(transferTX).to.changeTokenBalances(
      testERC20Tokens[1],
      [relayAdapt7702.address, primaryAccount.address],
      [-(2n * 10n ** 18n), 2n * 10n ** 18n],
    );

    expect(await testERC721.ownerOf(10n)).to.equal(primaryAccount.address);
  });

  it('Should wrap and unwrap ETH', async () => {
    const { relayAdapt7702, relayAdapt7702Relayer, weth9, secondaryAccount, primaryAccount, chainID } = await loadFixture(deploy);

    // Mint ETH to relayAdapt
    await setBalance(relayAdapt7702.address, '0x01F4');

    // Prepare Wrap Call
    const wrapCall = {
        to: relayAdapt7702.address,
        data: relayAdapt7702.interface.encodeFunctionData('wrapBase', [100]),
        value: 0n,
    };

    const actionDataWrap = {
        requireSuccess: true,
        minGasLimit: BigInt(10000),
        calls: [wrapCall],
    };

    // Sign Payload
    const signature = await getRelayAdapt7702Signature(
        secondaryAccount,
        chainID,
        [],
        actionDataWrap,
    );
    const serializedActionDataWrap = serializeActionData(actionDataWrap);

    // Execute Wrap
    const wrapTX = await executeRelayAdapt(
      relayAdapt7702Relayer as any,
      [],
      serializedActionDataWrap,
      signature,
    );

    await expect(wrapTX).to.changeEtherBalances([relayAdapt7702.address, weth9.address], [-100, 100]);
    await expect(wrapTX).to.changeTokenBalance(weth9, relayAdapt7702.address, 100);

    // Prepare Unwrap Call
    const unwrapCall = {
        to: relayAdapt7702.address,
        data: relayAdapt7702.interface.encodeFunctionData('unwrapBase', [100]),
        value: 0n,
    };

    const actionDataUnwrap = {
        requireSuccess: true,
        minGasLimit: BigInt(10000),
        calls: [unwrapCall],
    };

    // Sign Payload for Unwrap
    const signatureUnwrap = await getRelayAdapt7702Signature(
        secondaryAccount,
        chainID,
        [],
        actionDataUnwrap,
    );
    const serializedActionDataUnwrap = serializeActionData(actionDataUnwrap);

    // Execute Unwrap
    const unwrapTX = await executeRelayAdapt(
      relayAdapt7702Relayer as any,
      [],
      serializedActionDataUnwrap,
      signatureUnwrap,
    );

    await expect(unwrapTX).to.changeEtherBalances([relayAdapt7702.address, weth9.address], [100, -100]);
    await expect(unwrapTX).to.changeTokenBalance(weth9, relayAdapt7702.address, -100);
  });

  it('Should multicall', async () => {
    const {
      primaryAccount,
      secondaryAccount,
      relayAdapt7702,
      relayAdapt7702Relayer,
      testERC20Tokens,
      railgunSmartWallet,
      chainID,
    } = await loadFixture(deploy);

    // Deploy multicall target
    const GovernanceStateChangeTargetStub = await ethers.getContractFactory(
      'GovernanceStateChangeTargetStub',
    );
    const governanceStateChangeTargetStub = await GovernanceStateChangeTargetStub.deploy('hello');

    // Deploy contract that will revert on ETH received
    const GovernanceTargetAlphaStub = await ethers.getContractFactory('GovernanceTargetAlphaStub');
    const governanceTargetAlphaStub = await GovernanceTargetAlphaStub.deploy();

    // 1. Call external contract
    const callExternal = {
      to: governanceStateChangeTargetStub.address,
      data: governanceStateChangeTargetStub.interface.encodeFunctionData('changeGreeting', ['hi']),
      value: 0n,
    };

    let nonce = (await relayAdapt7702.nonce()).toBigInt();
    let signature = await getRelayAdapt7702MulticallSignature(
      secondaryAccount,
      chainID,
      false, // requireSuccess
      [callExternal],
      nonce,
    );

    await relayAdapt7702Relayer.multicall(false, [callExternal], nonce, signature);

    expect(await governanceStateChangeTargetStub.greeting()).to.equal('hi');

    // 2. Call internal contract (transfer)
    // Mint ERC20 tokens
    await testERC20Tokens[0].mint(relayAdapt7702.address, 10n ** 18n);

    const callInternal = {
      to: relayAdapt7702.address,
      data: encodeRelayAdaptFunctionData(relayAdapt7702, 'transfer', [
        [
          serializeTokenTransfer({
            to: primaryAccount.address,
            value: 10n ** 18n,
            token: {
              tokenType: TokenType.ERC20,
              tokenAddress: testERC20Tokens[0].address,
              tokenSubID: 0n,
            },
          }),
        ],
      ]),
      value: 0n,
    };

    nonce = (await relayAdapt7702.nonce()).toBigInt();
    signature = await getRelayAdapt7702MulticallSignature(
      secondaryAccount,
      chainID,
      true, // requireSuccess
      [callInternal],
      nonce,
    );

    await expect(
      relayAdapt7702Relayer.multicall(true, [callInternal], nonce, signature),
    ).to.changeTokenBalances(
      testERC20Tokens[0],
      [relayAdapt7702.address, primaryAccount.address],
      [-(10n ** 18n), 10n ** 18n],
    );

    // 3. Should throw on external contract failure if require success is true
    const callRevert = {
      to: governanceTargetAlphaStub.address,
      data: governanceTargetAlphaStub.interface.encodeFunctionData('willRevert'),
      value: 0n,
    };

    nonce = (await relayAdapt7702.nonce()).toBigInt();
    signature = await getRelayAdapt7702MulticallSignature(
      secondaryAccount,
      chainID,
      true, // requireSuccess
      [callRevert],
      nonce,
    );

    await expect(
      relayAdapt7702Relayer.multicall(true, [callRevert], nonce, signature),
    )
      .to.be.revertedWithCustomError(relayAdapt7702, 'CallFailed')
      .withArgs(
        0,
        `0x08c379a0${ethers.utils.defaultAbiCoder
          .encode(['bytes'], [fromUTF8String('1 is not equal to 2')])
          .slice(2)}`,
      );

    // 4. Should not throw on external contract failure if require success is false
    nonce = (await relayAdapt7702.nonce()).toBigInt();
    signature = await getRelayAdapt7702MulticallSignature(
      secondaryAccount,
      chainID,
      false, // requireSuccess
      [callRevert],
      nonce,
    );

    await expect(
      relayAdapt7702Relayer.multicall(false, [callRevert], nonce, signature),
    )
      .to.emit(relayAdapt7702, 'CallError')
      .withArgs(
        0,
        `0x08c379a0${ethers.utils.defaultAbiCoder
          .encode(['bytes'], [fromUTF8String('1 is not equal to 2')])
          .slice(2)}`,
      );

    // 5. Should prevent reentrancy
    const MaliciousReentrant = await ethers.getContractFactory('MaliciousReentrant');
    const maliciousReentrant = await MaliciousReentrant.deploy();

    const callAttack = {
      to: maliciousReentrant.address,
      data: maliciousReentrant.interface.encodeFunctionData('attack'),
      value: 0n,
    };

    nonce = (await relayAdapt7702.nonce()).toBigInt();
    signature = await getRelayAdapt7702MulticallSignature(
      secondaryAccount,
      chainID,
      true, // requireSuccess
      [callAttack],
      nonce,
    );

    await expect(
      relayAdapt7702Relayer.multicall(true, [callAttack], nonce, signature),
    ).to.eventually.be.fulfilled;

    // 6. Should fail if call is to core contract
    const callCore = {
      to: railgunSmartWallet.address,
      data: railgunSmartWallet.interface.encodeFunctionData('transact', [[]]),
      value: 0n,
    };

    nonce = (await relayAdapt7702.nonce()).toBigInt();
    signature = await getRelayAdapt7702MulticallSignature(
      secondaryAccount,
      chainID,
      true, // requireSuccess
      [callCore],
      nonce,
    );

    await expect(
      relayAdapt7702Relayer.multicall(true, [callCore], nonce, signature),
    ).to.be.revertedWithCustomError(relayAdapt7702, 'CallFailed');
  });

  it('Should submit relay bundle', async () => {
    const {
      chainID,
      secondaryAccount,
      primaryAccount,
      relayAdapt7702,
      relayAdapt7702Relayer,
      relayAdapt7702Bypass,
      snarkBypassSigner,
      railgunSmartWallet,
      testERC20Tokens,
    } = await loadFixture(deploy);

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

    const transactions = await transactWithAdaptParams(merkletree, actionData, [
      {
        minGasPrice: 0n,
        unshield: UnshieldType.NONE,
        chainID,
        adaptContract: secondaryAccount.address,
        notesIn: notesInOut.inputs,
        notesOut: notesInOut.outputs,
      },
    ]);

    // Sign Relayer Binding
    const signature = await getRelayAdapt7702Signature(
      secondaryAccount,
      chainID,
      transactions,
      actionData,
    );
    const serializedTransactions = transactions.map(serializeTransaction);
    const serializedActionData = serializeActionData(actionData);

    // Should reject if not enough gas is supplied
    await expect(
      executeRelayAdapt(
        relayAdapt7702Relayer as any,
        serializedTransactions,
        serializedActionData,
        signature,
        { gasLimit: 5000000n },
      ),
    ).to.be.revertedWith('RelayAdapt: Not enough gas supplied');

    // Submit transaction
    const relayTX = await executeRelayAdapt(
      relayAdapt7702Relayer as any,
      serializedTransactions,
      serializedActionData,
      signature,
      { gasLimit: 11000000n },
    );

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
        relayAdapt7702.address,
        new Uint8Array(32),
        notesInOutSnarkBypass.inputs,
        notesInOutSnarkBypass.outputs,
      ),
    ];

    // Sign Relayer Binding for Bypass Signer
    const signatureBypass = await getRelayAdapt7702Signature(
      secondaryAccount,
      chainID,
      transactionsSnarkBypass,
      actionDataNoOp,
    );
    const serializedTransactionsSnarkBypass = transactionsSnarkBypass.map(serializeTransaction);
    const serializedActionDataNoOp = serializeActionData(actionDataNoOp);

    await expect(
      executeRelayAdapt(
        relayAdapt7702Bypass as any,
        serializedTransactionsSnarkBypass,
        serializedActionDataNoOp,
        signatureBypass,
      ),
    ).to.eventually.be.fulfilled;
  });

  it('Should revert if not enough gas supplied', async () => {
    const {
      relayAdapt7702Relayer,
      relayAdapt7702,
      secondaryAccount,
      primaryAccount,
      chainID,
      railgunSmartWallet,
      testERC20Tokens,
    } = await loadFixture(deploy);

    // Mint tokens to relayAdapt7702 to verify they don't move
    await testERC20Tokens[0].mint(relayAdapt7702.address, 10n ** 18n);

    // 1. Prepare Dummy Transaction
    const merkletree = await MerkleTree.createTree();
    const tokenData = {
        tokenType: TokenType.ERC20,
        tokenAddress: arrayToHexString(randomBytes(20), true),
        tokenSubID: 0n,
    };
    const notesIn = [new Note(randomBytes(32), randomBytes(32), 100n, randomBytes(16), tokenData, '')];
    const notesOut = [new Note(randomBytes(32), randomBytes(32), 100n, randomBytes(16), tokenData, '')];
    
    await merkletree.insertLeaves(await Promise.all(notesIn.map((note) => note.getHash())), 0);
    await railgunSmartWallet.setMerkleRoot(0, merkletree.root, true);

    const transactions = [
      await dummyTransact(
        merkletree,
        BigInt(0),
        UnshieldType.NONE,
        chainID,
        secondaryAccount.address,
        randomBytes(32),
        notesIn,
        notesOut,
      ),
    ];

    // 2. Prepare Action Data with HIGH minGasLimit and a Transfer Call
    // If this didn't revert, tokens would move.
    const transferCall = {
        to: relayAdapt7702.address,
      data: encodeRelayAdaptFunctionData(relayAdapt7702, 'transfer', [[
        serializeTokenTransfer({
                to: primaryAccount.address,
                value: 10n ** 18n,
                token: {
                  tokenType: TokenType.ERC20,
                  tokenAddress: testERC20Tokens[0].address,
                  tokenSubID: 0n,
                },
        }),
      ]]),
        value: 0n,
    };

    const actionData = {
      requireSuccess: true,
      minGasLimit: BigInt(20000000), // Very high gas limit
      calls: [transferCall],
    };

    transactions[0].boundParams.adaptParams = new Uint8Array(32);
    const serializedTransactions = transactions.map(serializeTransaction);
    const serializedActionData = serializeActionData(actionData);

    // 4. Sign Payload
    const signature = await getRelayAdapt7702Signature(
        secondaryAccount,
        chainID,
        transactions,
        actionData,
    );

    // 5. Get balances before
    const balanceBeforeRelay = await testERC20Tokens[0].balanceOf(relayAdapt7702.address);
    const balanceBeforePrimary = await testERC20Tokens[0].balanceOf(primaryAccount.address);
    const nextLeafIndexBefore = await railgunSmartWallet.nextLeafIndex();
    const merkleRootBefore = await railgunSmartWallet.merkleRoot();

    // 6. Execute with insufficient gas and expect revert
    await expect(
        executeRelayAdapt(
          relayAdapt7702Relayer as any,
          serializedTransactions,
          serializedActionData,
          signature,
          { gasLimit: 10000000 },
        )
    ).to.be.revertedWith('RelayAdapt: Not enough gas supplied');

    // 7. Get balances after
    const balanceAfterRelay = await testERC20Tokens[0].balanceOf(relayAdapt7702.address);
    const balanceAfterPrimary = await testERC20Tokens[0].balanceOf(primaryAccount.address);
    const nextLeafIndexAfter = await railgunSmartWallet.nextLeafIndex();
    const merkleRootAfter = await railgunSmartWallet.merkleRoot();

    // 8. Assert no change
    expect(balanceAfterRelay).to.equal(balanceBeforeRelay);
    expect(balanceAfterPrimary).to.equal(balanceBeforePrimary);
    expect(nextLeafIndexAfter).to.equal(nextLeafIndexBefore);
    expect(merkleRootAfter).to.equal(merkleRootBefore);
  });

});
