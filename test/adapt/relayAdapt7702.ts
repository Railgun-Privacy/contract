import { ethers, network } from 'hardhat';
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

describe('Adapt/RelayAdapt7702', () => {
  const EXECUTE_SIGNATURE = 'execute((((uint256,uint256),(uint256[2],uint256[2]),(uint256,uint256)),bytes32,bytes32[],bytes32[],(uint16,uint72,uint8,uint64,address,bytes32,(bytes32[4],bytes32,bytes32,bytes,bytes)[]),(bytes32,(uint8,address,uint256),uint120))[],(bytes31,bool,uint256,(address,bytes,uint256)[]),bytes)';

  const getRelayAdapt7702Signature = async (
    signer: any,
    chainID: bigint,
    transactions: any[],
    actionData: any,
  ) => {
    const adaptParams = getAdaptParams(transactions, actionData);
    
    const domain = {
      name: 'RelayAdapt7702',
      version: '1',
      chainId: chainID,
      verifyingContract: signer.address,
    };

    const types = {
      Relay: [
        { name: 'adaptParams', type: 'bytes32' },
      ],
    };

    const value = {
      adaptParams: arrayToHexString(adaptParams, true),
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
      Call: [
        { name: 'to', type: 'address' },
        { name: 'data', type: 'bytes' },
        { name: 'value', type: 'uint256' },
      ],
      Multicall: [
        { name: 'requireSuccess', type: 'bool' },
        { name: 'calls', type: 'Call[]' },
        { name: 'nonce', type: 'uint256' },
      ],
    };

    const value = {
      requireSuccess,
      calls,
      nonce,
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

    // Deploy RelayAdapt7702Deployer
    const RelayAdapt7702Deployer = await ethers.getContractFactory('RelayAdapt7702Deployer');
    const relayAdapt7702Deployer = await RelayAdapt7702Deployer.deploy(primaryAccount.address);
    await relayAdapt7702Deployer.deployed();

    // Deploy RelayAdapt7702 Template via Deployer
    const RelayAdapt7702 = await ethers.getContractFactory('RelayAdapt7702');
    // console.log("\nDeploying Relay Adapt 7702 via Deployer...", RelayAdapt7702);
    const relayAdapt7702DeployTx = RelayAdapt7702.getDeployTransaction(railgunSmartWallet.address, weth9.address);
    const relayAdapt7702Bytecode = relayAdapt7702DeployTx.data;
    const salt = ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 32);

    const deployTx = await relayAdapt7702Deployer.deploy(relayAdapt7702Bytecode, salt);
    const receipt = await deployTx.wait();
    const deployedEvent = receipt.events?.find((e: any) => e.event === 'Deployed');
    const relayAdapt7702Address = deployedEvent?.args?.deployment;
    console.log(`\nRelay Adapt 7702 deployed at ${relayAdapt7702Address}`);
    
    const relayAdapt7702Template = RelayAdapt7702.attach(relayAdapt7702Address);

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

  it('Should calculate adapt parameters', async function () {
    this.timeout(5 * 60 * 60 * 1000);
    const loops = process.env.SKIP_LONG_TESTS ? 5n : 10n;

    const { chainID, relayAdapt7702 } = await loadFixture(deploy);

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
              relayAdapt7702.address,
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
      expect(await relayAdapt7702.getAdaptParams(transactions, actionData)).to.equal(
        arrayToHexString(getAdaptParams(transactions, actionData), true),
      );
    }
  });

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
      random: randomBytes(31),
      requireSuccess: true,
      minGasLimit: BigInt(10000),
      calls: [],
    };

    // 3. Calculate Adapt Params
    const adaptParams = getAdaptParams(transactions, actionData);
    transactions[0].boundParams.adaptParams = arrayToHexString(adaptParams, true);

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
        relayAdapt7702Bypass[EXECUTE_SIGNATURE](transactions, actionData, signature),
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
      random: randomBytes(31),
      requireSuccess: true,
      minGasLimit: BigInt(10000),
      calls: [],
    };

    // 4. Sign Payload with WRONG signer (primaryAccount instead of secondaryAccount)
    const signature = await getRelayAdapt7702Signature(
      primaryAccount,
      chainID,
      transactions,
      actionData,
    );

    // 5. Execute
    await expect(
        relayAdapt7702Relayer[EXECUTE_SIGNATURE](transactions, actionData, signature),
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
        data: relayAdapt7702.interface.encodeFunctionData('shield', [[shieldRequest]]),
        value: 0n,
    };

    const actionData = {
        random: randomBytes(31),
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

    // Execute Shield
    const shieldTransaction = await relayAdapt7702Relayer[EXECUTE_SIGNATURE]([], actionData, signature);

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
        data: relayAdapt7702.interface.encodeFunctionData('shield', [[shieldRequest, shieldRequest, shieldRequest]]),
        value: 0n,
    };

    const actionData = {
        random: randomBytes(31),
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

    // Execute Shield
    await relayAdapt7702Relayer[EXECUTE_SIGNATURE]([], actionData, signature);

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
        data: relayAdapt7702.interface.encodeFunctionData('shield', [[shieldRequest]]),
        value: 0n,
    };

    const actionData = {
        random: randomBytes(31),
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

    // Execute Shield
    await relayAdapt7702Relayer[EXECUTE_SIGNATURE]([], actionData, signature);

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
        data: relayAdapt7702.interface.encodeFunctionData('shield', [[shieldRequest]]),
        value: 0n,
    };

    const actionData = {
        random: randomBytes(31),
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

    // Execute Shield
    await expect(
        relayAdapt7702Relayer[EXECUTE_SIGNATURE]([], actionData, signature)
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
        data: relayAdapt7702.interface.encodeFunctionData('transfer', [[
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
        ]]),
        value: 0n,
    };

    const actionData = {
        random: randomBytes(31),
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

    // Execute Transfer
    const transferTX = await relayAdapt7702Relayer[EXECUTE_SIGNATURE]([], actionData, signature);

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
        random: randomBytes(31),
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

    // Execute Wrap
    const wrapTX = await relayAdapt7702Relayer[EXECUTE_SIGNATURE]([], actionDataWrap, signature);

    await expect(wrapTX).to.changeEtherBalances([relayAdapt7702.address, weth9.address], [-100, 100]);
    await expect(wrapTX).to.changeTokenBalance(weth9, relayAdapt7702.address, 100);

    // Prepare Unwrap Call
    const unwrapCall = {
        to: relayAdapt7702.address,
        data: relayAdapt7702.interface.encodeFunctionData('unwrapBase', [100]),
        value: 0n,
    };

    const actionDataUnwrap = {
        random: randomBytes(31),
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

    // Execute Unwrap
    const unwrapTX = await relayAdapt7702Relayer[EXECUTE_SIGNATURE]([], actionDataUnwrap, signatureUnwrap);

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

    let nonce = await relayAdapt7702.nonce();
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
      data: relayAdapt7702.interface.encodeFunctionData('transfer', [
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
    };

    nonce = await relayAdapt7702.nonce();
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

    nonce = await relayAdapt7702.nonce();
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
    nonce = await relayAdapt7702.nonce();
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

    nonce = await relayAdapt7702.nonce();
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

    nonce = await relayAdapt7702.nonce();
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

    const transactionsWrongAdaptID = [
      await dummyTransact(
        merkletree,
        0n,
        UnshieldType.NONE,
        chainID,
        secondaryAccount.address,
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

    // Should reject if not enough gas is supplied
    await expect(
      relayAdapt7702Relayer[EXECUTE_SIGNATURE](transactions, actionData, signature, { gasLimit: 5000000n }),
    ).to.be.revertedWith('RelayAdapt: Not enough gas supplied');

    // Should reject if wrong adapt params is supplied
    // Note: We need to sign the WRONG transactions to pass the signature check,
    // but fail the adapt params check.
    const signatureWrong = await getRelayAdapt7702Signature(
      secondaryAccount,
      chainID,
      transactionsWrongAdaptID,
      actionData,
    );
    await expect(
      relayAdapt7702Relayer[EXECUTE_SIGNATURE](transactionsWrongAdaptID, actionData, signatureWrong, {
        gasLimit: 11000000n,
      }),
    ).to.be.revertedWith('RelayAdapt: AdaptID Parameters Mismatch');

    // Submit transaction
    const relayTX = await relayAdapt7702Relayer[EXECUTE_SIGNATURE](transactions, actionData, signature, {
      gasLimit: 11000000n,
    });

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

    await expect(
      relayAdapt7702Bypass[EXECUTE_SIGNATURE](transactionsSnarkBypass, actionDataNoOp, signatureBypass),
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
        data: relayAdapt7702.interface.encodeFunctionData('transfer', [[
            {
                to: primaryAccount.address,
                value: 10n ** 18n,
                token: {
                  tokenType: TokenType.ERC20,
                  tokenAddress: testERC20Tokens[0].address,
                  tokenSubID: 0n,
                },
            },
        ]]),
        value: 0n,
    };

    const actionData = {
      random: randomBytes(31),
      requireSuccess: true,
      minGasLimit: BigInt(20000000), // Very high gas limit
      calls: [transferCall],
    };

    // 3. Calculate Adapt Params
    const adaptParams = getAdaptParams(transactions, actionData);
    transactions[0].boundParams.adaptParams = arrayToHexString(adaptParams, true);

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
        relayAdapt7702Relayer[EXECUTE_SIGNATURE](transactions, actionData, signature, { gasLimit: 10000000 })
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

  it('Should revert if adapt params mismatch', async () => {
    const {
      relayAdapt7702Relayer,
      secondaryAccount,
      chainID,
      railgunSmartWallet,
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

    // 2. Prepare Action Data
    const actionData = {
      random: randomBytes(31),
      requireSuccess: true,
      minGasLimit: BigInt(10000),
      calls: [],
    };

    // 3. Calculate Adapt Params BUT use wrong one in transaction
    const adaptParams = getAdaptParams(transactions, actionData);
    // Tamper with adapt params
    transactions[0].boundParams.adaptParams = arrayToHexString(randomBytes(32), true);

    // 4. Sign Payload
    // Note: We sign the TAMPERED transactions to pass the signature check,
    // but fail the adapt params check.
    const signature = await getRelayAdapt7702Signature(
        secondaryAccount,
        chainID,
        transactions,
        actionData,
    );

    // 5. Execute
    await expect(
        relayAdapt7702Relayer[EXECUTE_SIGNATURE](transactions, actionData, signature)
    ).to.be.revertedWith('RelayAdapt: AdaptID Parameters Mismatch');
  });
});
