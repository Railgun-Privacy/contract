import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { Wallet } from '../helpers/logic/wallet';
import { Note, TokenType } from '../helpers/logic/note';
import { randomBytes } from '../helpers/global/crypto';
import { arrayToHexString } from '../helpers/global/bytes';
import { MerkleTree } from '../helpers/logic/merkletree';
import { transact, UnshieldType } from '../helpers/logic/transaction';

/**
 * Calculate adaptParams to match RelayAdapt.getAdaptParams()
 * 
 * In Solidity:
 * return keccak256(abi.encode(nullifiers, _transactions.length, _actionData));
 */
interface ActionDataCall {
  to: string;
  data: string;
  value: any; // ethers.BigNumber
}

interface ActionData {
  random: string;
  requireSuccess: boolean;
  minGasLimit: number;
  calls: ActionDataCall[];
}

async function calculateAdaptParams(
  merkletree: MerkleTree,
  inputNotes: Note[],
  transactionsLength: number,
  actionData: ActionData
): Promise<Uint8Array> {
  // 1. Calculate nullifiers for each input note
  const nullifiers: string[][] = [];
  const txNullifiers: string[] = [];
  
  for (const note of inputNotes) {
    const noteHash = await note.getHash();
    const merkleProof = merkletree.generateProof(noteHash);
    const nullifier = await note.getNullifier(merkleProof.indices);
    txNullifiers.push(arrayToHexString(nullifier, true));
  }
  nullifiers.push(txNullifiers);

  // 2. Encode like Solidity: abi.encode(nullifiers, transactionsLength, actionData)
  const encoded = ethers.utils.defaultAbiCoder.encode(
    [
      'bytes32[][]',  // nullifiers (2D array)
      'uint256',      // transactions.length
      'tuple(bytes31 random, bool requireSuccess, uint256 minGasLimit, tuple(address to, bytes data, uint256 value)[] calls)',  // ActionData
    ],
    [
      nullifiers,
      transactionsLength,
      actionData,
    ]
  );

  // 3. Hash it
  const hash = ethers.utils.keccak256(encoded);
  
  // Convert to Uint8Array
  const result = new Uint8Array(32);
  const hashBytes = ethers.utils.arrayify(hash);
  result.set(hashBytes);
  
  return result;
}

/**
 * Interaction script - Connect to deployed contracts for testing
 * 
 * Architecture:
 * - deployer (account 0): Contract owner, governance
 * - broadcaster (account 1): Submits delegateShield and relay transactions
 * - user (account 2): End user who wants to shield/transact
 *
 * Usage:
 * 1. Ensure hardhat node is running
 * 2. Ensure contracts are deployed via yarn deploy (generates deployments.json automatically)
 * 3. Run: npx hardhat run scripts/demo.ts --network localhost
 */

// EIP-712 type definitions for DelegateShield
const DELEGATE_SHIELD_TYPES = {
  DelegateShield: [
    { name: 'npk', type: 'bytes32' },
    { name: 'tokenAddress', type: 'address' },
    { name: 'tokenType', type: 'uint8' },
    { name: 'tokenSubID', type: 'uint256' },
    { name: 'value', type: 'uint120' },
    { name: 'encryptedBundle0', type: 'bytes32' },
    { name: 'encryptedBundle1', type: 'bytes32' },
    { name: 'encryptedBundle2', type: 'bytes32' },
    { name: 'shieldKey', type: 'bytes32' },
    { name: 'from', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

async function main() {
  // ========== Read deployment config from JSON file ==========
  const configPath = path.join(__dirname, '../deployments.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Deployment config file not found: ${configPath}\n` +
      'Please run: yarn deploy'
    );
  }

  const deployConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const RAILGUN_SMART_WALLET_ADDRESS = deployConfig.proxy;
  const RELAY_ADAPT_ADDRESS = deployConfig.relayAdaptProxy;
  const TEST_ERC20_ADDRESS = deployConfig.testERC20;
  const POSEIDON_T3_ADDRESS = deployConfig.poseidonT3;
  const POSEIDON_T4_ADDRESS = deployConfig.poseidonT4;

  console.log('📋 Reading config from deployments.json:');
  console.log('  RailgunSmartWallet (proxy):', RAILGUN_SMART_WALLET_ADDRESS);
  console.log('  RelayAdapt (proxy):', RELAY_ADAPT_ADDRESS);
  console.log('  TestERC20:', TEST_ERC20_ADDRESS);
  console.log('  PoseidonT3:', POSEIDON_T3_ADDRESS);
  console.log('  PoseidonT4:', POSEIDON_T4_ADDRESS);

  // ========== Get accounts ==========
  // deployer (0): owner, broadcaster (1): submits tx, user (2): end user
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const broadcaster = signers[1];
  const user = signers[2];
  
  console.log('\n=== Accounts ===');
  console.log('Deployer:', deployer.address);
  console.log('Broadcaster:', broadcaster.address);
  console.log('User:', user.address);

  // ========== Connect to deployed contracts ==========
  // Get RailgunSmartWallet factory with library links
  const RailgunSmartWallet = await ethers.getContractFactory('RailgunSmartWalletStub', {
    libraries: {
      PoseidonT3: POSEIDON_T3_ADDRESS,
      PoseidonT4: POSEIDON_T4_ADDRESS,
    },
  });
  const railgun = RailgunSmartWallet.attach(RAILGUN_SMART_WALLET_ADDRESS);

  const RelayAdapt = await ethers.getContractFactory('RelayAdapt');
  const relayAdapt = RelayAdapt.attach(RELAY_ADAPT_ADDRESS);

  const TestERC20 = await ethers.getContractFactory('TestERC20');
  const testERC20 = TestERC20.attach(TEST_ERC20_ADDRESS);

  console.log('\n=== Contract Addresses ===');
  console.log('RailgunSmartWallet:', railgun.address);
  console.log('RelayAdapt:', relayAdapt.address);
  console.log('TestERC20:', testERC20.address);

  // ========== Check RelayAdapt configuration ==========
  console.log('\n=== RelayAdapt Config ===');
  const configuredBroadcaster = await relayAdapt.broadcaster();
  console.log('Configured Broadcaster:', configuredBroadcaster);
  console.log('Broadcaster matches:', configuredBroadcaster === broadcaster.address);

  // ========== Prepare tokens for user ==========
  console.log('\n=== Preparing Tokens for User ===');
  
  // Mint tokens to user
  const userBalance = await testERC20.balanceOf(user.address);
  console.log('User ERC20 balance:', ethers.utils.formatEther(userBalance));

  if (userBalance.lt(ethers.utils.parseEther('5'))) {
    console.log('Minting tokens to user...');
    await (await testERC20.mint(user.address, ethers.utils.parseEther('10'))).wait();
    console.log('New user balance:', ethers.utils.formatEther(await testERC20.balanceOf(user.address)));
  }

  // User approves RelayAdapt (not RailgunSmartWallet directly)
  const allowance = await testERC20.allowance(user.address, relayAdapt.address);
  if (allowance.lt(ethers.utils.parseEther('5'))) {
    console.log('User approving tokens to RelayAdapt...');
    await (await testERC20.connect(user).approve(relayAdapt.address, ethers.constants.MaxUint256)).wait();
    console.log('Approval complete');
  }

  // ========== Example 1: Shield ERC20 via DelegateShield ==========
  console.log('\n=== Example 1: Shield ERC20 via DelegateShield ===');

  // 1.1 Create merkle tree and wallet
  const merkletree = await MerkleTree.createTree();
  const wallet1 = new Wallet(randomBytes(32), randomBytes(32));
  console.log('MerkleTree created');
  console.log('Wallet1 created');

  // 1.2 Prepare token data
  const tokenData = {
    tokenType: TokenType.ERC20,
    tokenAddress: testERC20.address,
    tokenSubID: 0n,
  };
  wallet1.tokens.push(tokenData);

  // 1.3 Create multiple notes for shield
  const shieldNotes = [
    new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
    new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
    new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
  ];

  // 1.4 Encrypt notes for shield
  const shieldRequests = await Promise.all(
    shieldNotes.map((note) => note.encryptForShield())
  );
  console.log('Shield requests prepared:', shieldRequests.length);

  // 1.5 Get user's nonce from RelayAdapt
  const userNonce = await relayAdapt.getNonce(user.address);
  console.log('User nonce:', userNonce.toString());

  // 1.6 Prepare EIP-712 domain
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const domain = {
    name: 'RelayAdapt',
    version: '1',
    chainId: chainId,
    verifyingContract: relayAdapt.address,
  };

  // 1.7 Prepare DelegateShieldRequests and signatures
  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
  const delegateShieldRequests = [];
  const signatures = [];

  for (let i = 0; i < shieldRequests.length; i++) {
    const shieldReq = shieldRequests[i];
    const nonce = userNonce.add(i);

    // Prepare message for signing
    const message = {
      npk: shieldReq.preimage.npk,
      tokenAddress: shieldReq.preimage.token.tokenAddress,
      tokenType: shieldReq.preimage.token.tokenType,
      tokenSubID: shieldReq.preimage.token.tokenSubID,
      value: shieldReq.preimage.value,
      encryptedBundle0: shieldReq.ciphertext.encryptedBundle[0],
      encryptedBundle1: shieldReq.ciphertext.encryptedBundle[1],
      encryptedBundle2: shieldReq.ciphertext.encryptedBundle[2],
      shieldKey: shieldReq.ciphertext.shieldKey,
      from: user.address,
      nonce: nonce,
      deadline: deadline,
    };

    // User signs the message
    const signature = await user._signTypedData(domain, DELEGATE_SHIELD_TYPES, message);
    signatures.push(signature);

    // Prepare DelegateShieldRequest struct
    delegateShieldRequests.push({
      shieldRequest: shieldReq,
      from: user.address,
      nonce: nonce,
      deadline: deadline,
    });
  }

  console.log('Signatures generated:', signatures.length);

  // 1.8 Broadcaster calls delegateShield
  console.log('Broadcaster executing delegateShield...');
  const shieldTx = await relayAdapt.connect(broadcaster).delegateShield(
    delegateShieldRequests,
    signatures
  );
  const shieldReceipt = await shieldTx.wait();
  console.log('Shield transaction hash:', shieldReceipt.transactionHash);
  console.log('Shield block number:', shieldReceipt.blockNumber);

  // ========== (Optional) Query Shield Events ==========
  /*
  console.log('\nQuerying Shield Events...');
  const shieldFilter = railgun.filters.Shield();
  const shieldEvents = await railgun.queryFilter(shieldFilter, shieldReceipt.blockNumber);
  console.log('Shield events found:', shieldEvents.length);
  if (shieldEvents.length > 0) {
    const event = shieldEvents[0];
    console.log('Tree number:', event.args.treeNumber.toString());
    console.log('Start position:', event.args.startPosition.toString());
    console.log('Commitments count:', event.args.commitments.length);
  }
  */

  // 1.9 Scan transaction (wallet side)
  console.log('\nScanning transaction...');
  await merkletree.scanTX(shieldTx, railgun);
  await wallet1.scanTX(shieldTx, railgun);
  console.log('Wallet1 notes count:', wallet1.notes.length);

  if (wallet1.notes.length > 0) {
    const note = wallet1.notes[0];
    console.log('Note value:', note.value.toString());
    console.log('Note token:', note.tokenData.tokenAddress);
  }

  // ========== Example 2: Private Transfer via Relay ==========
  console.log('\n=== Example 2: Private Transfer via Relay ===');

  // 2.1 Create second wallet (receiver)
  const wallet2 = new Wallet(randomBytes(32), randomBytes(32));
  wallet2.tokens.push(tokenData);
  console.log('Wallet2 (receiver) created');

  // 2.2 Get chain ID
  const chainID = BigInt((await ethers.provider.send('eth_chainId', [])) as string);

  // 2.3 Get transfer transaction inputs and outputs
  const transferNotes = await wallet1.getTestTransactionInputs(
    merkletree,
    2, // 2 input notes
    3, // 3 output notes
    false, // no unshield
    tokenData,
    wallet2.spendingKey, // receiver spending key
    wallet2.viewingKey, // receiver viewing key
  );

  const inputNotes = transferNotes.inputs;
  const outputNotes = transferNotes.outputs;

  console.log('Transfer inputs:', inputNotes.length);
  console.log('Transfer outputs:', outputNotes.length);

  // 2.4 Prepare actionData and calculate adaptParams BEFORE generating proof
  const actionData = {
    random: ethers.utils.hexlify(randomBytes(31)),
    requireSuccess: true,
    minGasLimit: 0,
    calls: [] as ActionDataCall[], // no additional calls
  };

  // Calculate adaptParams to match RelayAdapt.getAdaptParams()
  console.log('Calculating adaptParams...');
  const adaptParams = await calculateAdaptParams(
    merkletree,
    inputNotes,
    1, // transactionsLength = 1
    actionData
  );
  console.log('adaptParams:', ethers.utils.hexlify(adaptParams));

  // 2.5 Generate SNARK proof with correct adaptParams
  console.log('Generating SNARK proof (this may take a moment)...');
  const proofStartTime = Date.now();
  const transferTransaction = await transact(
    merkletree,
    0n, // minGasPrice
    UnshieldType.NONE, // no unshield
    chainID,
    relayAdapt.address, // adapt contract is RelayAdapt
    adaptParams, // use calculated adaptParams
    inputNotes,
    outputNotes,
  );
  const proofEndTime = Date.now();
  console.log(`✅ SNARK proof generated (${proofEndTime - proofStartTime}ms)`);

  // 2.6 Broadcaster executes relay
  console.log('Broadcaster executing relay...');

  const transferTx = await relayAdapt.connect(broadcaster).relay(
    [transferTransaction],
    actionData,
    { gasLimit: 5000000 }
  );
  const relayReceipt = await transferTx.wait();
  console.log('Relay transaction hash:', relayReceipt.transactionHash);
  console.log('Relay block number:', relayReceipt.blockNumber);

  // 2.7 Scan transfer transaction
  await merkletree.scanTX(transferTx, railgun);
  await wallet1.scanTX(transferTx, railgun);
  await wallet2.scanTX(transferTx, railgun);

  // 2.8 Check balances
  const wallet1Balance = await wallet1.getBalance(merkletree, tokenData);
  const wallet2Balance = await wallet2.getBalance(merkletree, tokenData);
  console.log('Wallet1 balance after transfer:', wallet1Balance.toString());
  console.log('Wallet2 balance after transfer:', wallet2Balance.toString());

  // ========== Example 3: Unshield via Relay ==========
  console.log('\n=== Example 3: Unshield via Relay ===');

  // 3.1 Get unshield transaction inputs and outputs
  const unshieldNotes = await wallet2.getTestTransactionInputs(
    merkletree,
    2, // 2 input notes
    3, // 3 output notes (last one will be unshield)
    user.address, // unshield to user's address
    tokenData,
    wallet2.spendingKey,
    wallet2.viewingKey,
  );

  console.log('Unshield inputs:', unshieldNotes.inputs.length);
  console.log('Unshield outputs:', unshieldNotes.outputs.length);
  console.log('Unshield to address:', user.address);

  // 3.2 Prepare actionData and calculate adaptParams BEFORE generating proof
  const unshieldActionData = {
    random: ethers.utils.hexlify(randomBytes(31)),
    requireSuccess: true,
    minGasLimit: 0,
    calls: [] as ActionDataCall[],
  };

  console.log('Calculating adaptParams for unshield...');
  const unshieldAdaptParams = await calculateAdaptParams(
    merkletree,
    unshieldNotes.inputs,
    1, // transactionsLength = 1
    unshieldActionData
  );
  console.log('unshieldAdaptParams:', ethers.utils.hexlify(unshieldAdaptParams));

  // 3.3 Generate SNARK proof with correct adaptParams
  console.log('Generating SNARK proof for unshield...');
  const unshieldProofStart = Date.now();
  const unshieldTransaction = await transact(
    merkletree,
    0n, // minGasPrice
    UnshieldType.NORMAL, // normal unshield
    chainID,
    relayAdapt.address, // adapt contract is RelayAdapt
    unshieldAdaptParams, // use calculated adaptParams
    unshieldNotes.inputs,
    unshieldNotes.outputs,
  );
  const unshieldProofEnd = Date.now();
  console.log(`✅ SNARK proof generated (${unshieldProofEnd - unshieldProofStart}ms)`);

  // 3.4 Broadcaster executes relay for unshield
  console.log('Broadcaster executing relay for unshield...');

  const unshieldTx = await relayAdapt.connect(broadcaster).relay(
    [unshieldTransaction],
    unshieldActionData,
    { gasLimit: 5000000 }
  );
  const unshieldReceipt = await unshieldTx.wait();
  console.log('Unshield transaction hash:', unshieldReceipt.transactionHash);
  console.log('Unshield block number:', unshieldReceipt.blockNumber);

  // 3.5 Check token balance of user
  const userFinalBalance = await testERC20.balanceOf(user.address);
  console.log('User ERC20 balance after unshield:', ethers.utils.formatEther(userFinalBalance));

  // 3.6 Scan unshield transaction
  await merkletree.scanTX(unshieldTx, railgun);
  await wallet1.scanTX(unshieldTx, railgun);
  await wallet2.scanTX(unshieldTx, railgun);

  // 3.7 Check final balances
  const wallet1FinalBalance = await wallet1.getBalance(merkletree, tokenData);
  const wallet2FinalBalance = await wallet2.getBalance(merkletree, tokenData);
  console.log('Wallet1 final balance:', wallet1FinalBalance.toString());
  console.log('Wallet2 final balance:', wallet2FinalBalance.toString());

  // ========== (Optional) Query Transact Events ==========
  /*
  console.log('\n=== Query Transact Events ===');
  const transactFilter = railgun.filters.Transact();
  const transactEvents = await railgun.queryFilter(transactFilter, shieldReceipt.blockNumber);
  console.log('Transact events found:', transactEvents.length);

  if (transactEvents.length > 0) {
    transactEvents.forEach((event, index) => {
      console.log(`\nTransact Event ${index + 1}:`);
      console.log('  Tree number:', event.args.treeNumber.toString());
      console.log('  Start position:', event.args.startPosition.toString());
      console.log('  Commitments count:', event.args.hash.length);
      console.log('  Block number:', event.blockNumber);
    });
  }
  */

  console.log('\n=== Test Complete ===');
  console.log('Summary:');
  console.log('  - User shielded 3 ETH worth of tokens via delegateShield');
  console.log('  - Wallet1 transferred to Wallet2 via relay');
  console.log('  - Wallet2 unshielded to user address via relay');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
