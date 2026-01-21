import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { Wallet } from '../helpers/logic/wallet';
import { Note, TokenType } from '../helpers/logic/note';
import { randomBytes } from '../helpers/global/crypto';
import { MerkleTree } from '../helpers/logic/merkletree';
import { transact, UnshieldType } from '../helpers/logic/transaction';

/**
 * Interaction script - Connect to deployed contracts for testing
 *
 * Usage:
 * 1. Ensure hardhat node is running
 * 2. Ensure contracts are deployed via yarn deploy (generates deployments.json automatically)
 * 3. Run: npx hardhat run scripts/demo.ts --network localhost
 */

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
  const TEST_ERC20_ADDRESS = deployConfig.testERC20;
  const POSEIDON_T3_ADDRESS = deployConfig.poseidonT3;
  const POSEIDON_T4_ADDRESS = deployConfig.poseidonT4;

  console.log('📋 Reading config from deployments.json:');
  console.log('  RailgunSmartWallet (proxy):', RAILGUN_SMART_WALLET_ADDRESS);
  console.log('  TestERC20:', TEST_ERC20_ADDRESS);
  console.log('  PoseidonT3:', POSEIDON_T3_ADDRESS);
  console.log('  PoseidonT4:', POSEIDON_T4_ADDRESS);

  // ========== Get accounts ==========
  const [deployer, user1] = await ethers.getSigners();
  console.log('Deployer address:', deployer.address);
  console.log('User1 address:', user1.address);

  // ========== Connect to deployed contracts ==========
  // Get RailgunSmartWallet factory with library links
  const RailgunSmartWallet = await ethers.getContractFactory('RailgunSmartWalletStub', {
    libraries: {
      PoseidonT3: POSEIDON_T3_ADDRESS,
      PoseidonT4: POSEIDON_T4_ADDRESS,
    },
  });
  const railgun = RailgunSmartWallet.attach(RAILGUN_SMART_WALLET_ADDRESS);

  const TestERC20 = await ethers.getContractFactory('TestERC20');
  const testERC20 = TestERC20.attach(TEST_ERC20_ADDRESS);

  console.log('\n=== Contract Addresses ===');
  console.log('RailgunSmartWallet:', railgun.address);
  console.log('TestERC20:', testERC20.address);

  // ========== Check contract status ==========
  console.log('\n=== Contract Status ===');
  const lastEventBlock = await railgun.lastEventBlock();
  console.log('Last Event Block:', lastEventBlock.toString());

  // ========== Prepare tokens and approval ==========
  console.log('\n=== Preparing Tokens ===');
  const balance = await testERC20.balanceOf(deployer.address);
  console.log('Deployer ERC20 balance:', ethers.utils.formatEther(balance));

  if (balance.lt(ethers.utils.parseEther('1'))) {
    console.log('Minting tokens...');
    await (await testERC20.mint(deployer.address, ethers.utils.parseEther('10'))).wait();
  }

  const allowance = await testERC20.allowance(deployer.address, railgun.address);
  if (allowance.lt(ethers.utils.parseEther('1'))) {
    console.log('Approving tokens...');
    await (await testERC20.approve(railgun.address, ethers.constants.MaxUint256)).wait();
  }

  // ========== Example 1: Shield ERC20 ==========
  console.log('\n=== Example 1: Shield ERC20 ===');

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

  // 1.3 Create multiple notes for shield (need multiple notes for transfer later)
  const shieldNotes = [
    new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
    new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
    new Note(wallet1.spendingKey, wallet1.viewingKey, 10n ** 18n, randomBytes(16), tokenData, ''),
  ];

  // 1.4 Encrypt notes
  const shieldRequests = await Promise.all(
    shieldNotes.map((note) => note.encryptForShield())
  );
  console.log('Shield requests prepared:', shieldRequests.length);

  // 1.5 Execute shield
  console.log('Shielding...');
  const shieldTx = await railgun.shield(shieldRequests);
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

  // 1.6 Scan transaction (wallet side)
  console.log('\nScanning transaction...');
  await merkletree.scanTX(shieldTx, railgun);
  await wallet1.scanTX(shieldTx, railgun);
  console.log('Wallet1 notes count:', wallet1.notes.length);

  if (wallet1.notes.length > 0) {
    const note = wallet1.notes[0];
    console.log('Note value:', note.value.toString());
    console.log('Note token:', note.tokenData.tokenAddress);
  }

  // ========== Example 2: Private Transfer (Anonymous Transfer) ==========
  console.log('\n=== Example 2: Private Transfer ===');

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

  // 2.4 Generate SNARK proof
  // Proof generation process:
  // a). Get circuit artifact (WASM + zkey) based on input/output note counts
  //    - Location: helpers/logic/artifacts.ts:getKeys()
  // b). Format circuit inputs (public + private inputs)
  //    - Location: helpers/logic/transaction.ts:formatCircuitInputs()
  //    - Public inputs: merkleRoot, boundParamsHash, nullifiers, commitmentsOut
  //    - Private inputs: token, publicKey, signature, randomIn, valueIn, pathElements, leavesIndices, nullifyingKey, npkOut, valueOut
  // c). Generate proof using Groth16 zk-SNARK
  //    - Location: helpers/logic/prover.ts:prove()
  //    - Uses: groth16.fullProve(inputs, artifact.wasm, artifact.zkey)
  //    - Returns: ProofBundle with javascript and solidity formats
  // d). Format public inputs for on-chain submission
  //    - Location: helpers/logic/transaction.ts:formatPublicInputs()
  //    - Includes: proof, merkleRoot, nullifiers, commitments, boundParams, unshieldPreimage
  console.log('Generating SNARK proof (this may take a moment)...');
  const proofStartTime = Date.now();
  const transferTransaction = await transact(
    merkletree,
    0n, // minGasPrice
    UnshieldType.NONE, // no unshield
    chainID,
    ethers.constants.AddressZero, // no adapt contract
    new Uint8Array(32), // no adapt params
    inputNotes,
    outputNotes,
  );
  const proofEndTime = Date.now();
  const proofDuration = proofEndTime - proofStartTime;
  console.log(`✅ SNARK proof generated successfully (${proofDuration}ms)`);

  // 2.5 Execute transfer
  console.log('Executing private transfer...');
  const transferTx = await railgun.transact([transferTransaction]);
  const transferReceipt = await transferTx.wait();
  console.log('Transfer transaction hash:', transferReceipt.transactionHash);
  console.log('Transfer block number:', transferReceipt.blockNumber);

  // 2.6 Scan transfer transaction
  await merkletree.scanTX(transferTx, railgun);
  await wallet1.scanTX(transferTx, railgun);
  await wallet2.scanTX(transferTx, railgun);

  // 2.7 Check balances
  const wallet1Balance = await wallet1.getBalance(merkletree, tokenData);
  const wallet2Balance = await wallet2.getBalance(merkletree, tokenData);
  console.log('Wallet1 balance after transfer:', wallet1Balance.toString());
  console.log('Wallet2 balance after transfer:', wallet2Balance.toString());

  // ========== Example 3: Unshield (Withdraw to Public Address) ==========
  console.log('\n=== Example 3: Unshield ===');

  // 3.1 Get unshield transaction inputs and outputs
  const unshieldNotes = await wallet2.getTestTransactionInputs(
    merkletree,
    2, // 2 input notes
    3, // 3 output notes (last one will be unshield)
    user1.address, // unshield to this address
    tokenData,
    wallet2.spendingKey,
    wallet2.viewingKey,
  );

  console.log('Unshield inputs:', unshieldNotes.inputs.length);
  console.log('Unshield outputs:', unshieldNotes.outputs.length);
  console.log('Unshield address:', user1.address);

  // 3.2 Generate SNARK proof
  console.log('Generating SNARK proof for unshield (this may take a moment)...');
  const unshieldProofStartTime = Date.now();
  const unshieldTransaction = await transact(
    merkletree,
    0n, // minGasPrice
    UnshieldType.NORMAL, // normal unshield
    chainID,
    ethers.constants.AddressZero, // no adapt contract
    new Uint8Array(32), // no adapt params
    unshieldNotes.inputs,
    unshieldNotes.outputs,
  );
  const unshieldProofEndTime = Date.now();
  const unshieldProofDuration = unshieldProofEndTime - unshieldProofStartTime;
  console.log(`✅ SNARK proof generated successfully (${unshieldProofDuration}ms)`);

  // 3.3 Execute unshield
  console.log('Executing unshield...');
  const unshieldTx = await railgun.transact([unshieldTransaction]);
  const unshieldReceipt = await unshieldTx.wait();
  console.log('Unshield transaction hash:', unshieldReceipt.transactionHash);
  console.log('Unshield block number:', unshieldReceipt.blockNumber);

  // 3.4 Check token balance of unshield address
  const unshieldAddressBalance = await testERC20.balanceOf(user1.address);
  console.log('Unshield address ERC20 balance:', ethers.utils.formatEther(unshieldAddressBalance));

  // 3.5 Scan unshield transaction
  await merkletree.scanTX(unshieldTx, railgun);
  await wallet1.scanTX(unshieldTx, railgun);
  await wallet2.scanTX(unshieldTx, railgun);

  // 3.6 Check final balances
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
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
