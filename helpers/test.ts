import { ethers } from 'hardhat';
import { hexStringToArray } from './global/bytes';
import { randomBytes } from './global/crypto';
import { MerkleTree } from './logic/merkletree';
import { Note } from './logic/note';
import { Wallet } from './logic/wallet';
import { transact } from './logic/transaction';
import { loadAllArtifacts } from './logic/artifacts';

async function main() {
  // Deploy poseidon libraries
  const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
  const PoseidonT4 = await ethers.getContractFactory('PoseidonT4');
  const poseidonT3 = await PoseidonT3.deploy();
  const poseidonT4 = await PoseidonT4.deploy();

  const RailgunSmartWallet = await ethers.getContractFactory('RailgunSmartWallet', {
    libraries: {
      PoseidonT3: poseidonT3.address,
      PoseidonT4: poseidonT4.address,
    },
  });
  const railgunSmartWallet = await RailgunSmartWallet.deploy();
  await railgunSmartWallet.initializeRailgunLogic(
    railgunSmartWallet.signer.getAddress(),
    25n,
    25n,
    25n,
    railgunSmartWallet.signer.getAddress(),
  );

  await loadAllArtifacts(railgunSmartWallet);

  // Deploy test ERC20 and approve for shield
  const TestERC20 = await ethers.getContractFactory('TestERC20');
  const testERC20 = await TestERC20.deploy();
  await testERC20.approve(railgunSmartWallet.address, 2n ** 256n - 1n);

  const viewingKey = hexStringToArray(
    '0001020304050607080910111213141516171819202122232425262728293031',
  );
  const spendingKey = hexStringToArray(
    '0001020304050607080910111213141516171819202122232425262728293031',
  );

  const tokenData = {
    tokenType: 0,
    tokenAddress: testERC20.address,
    tokenSubID: 0n,
  };

  const tree = await MerkleTree.createTree();
  const wallet = new Wallet(spendingKey, viewingKey);
  wallet.tokens.push(tokenData);

  const notes = [
    new Note(spendingKey, viewingKey, 10n, randomBytes(16), tokenData, ''),
    new Note(spendingKey, viewingKey, 20n, randomBytes(16), tokenData, ''),
    new Note(spendingKey, viewingKey, 30n, randomBytes(16), tokenData, ''),
    new Note(spendingKey, viewingKey, 40n, randomBytes(16), tokenData, ''),
    new Note(spendingKey, viewingKey, 50n, randomBytes(16), tokenData, ''),
    new Note(spendingKey, viewingKey, 60n, randomBytes(16), tokenData, ''),
    new Note(spendingKey, viewingKey, 70n, randomBytes(16), tokenData, ''),
    new Note(spendingKey, viewingKey, 80n, randomBytes(16), tokenData, ''),
    new Note(spendingKey, viewingKey, 90n, randomBytes(16), tokenData, ''),
  ];

  const shieldTransaction = await railgunSmartWallet.shield(
    await Promise.all(notes.map((note) => note.getCommitmentPreimage())),
    await Promise.all(notes.map((note) => note.encryptForShield())),
  );

  await tree.scanTX(shieldTransaction, railgunSmartWallet);

  await wallet.scanTX(shieldTransaction, railgunSmartWallet);

  const notesInputs = await wallet.getTestTransactionInputs(tree, 1, 2, false, tokenData);

  const transferTransaction = await railgunSmartWallet.transact([
    await transact(
      tree,
      0n,
      0,
      ethers.constants.AddressZero,
      hexStringToArray(ethers.constants.HashZero),
      notesInputs.inputs,
      notesInputs.outputs,
    ),
  ]);

  await tree.scanTX(transferTransaction, railgunSmartWallet);

  await wallet.scanTX(transferTransaction, railgunSmartWallet);

  console.log(tree);
  console.log(wallet);
  console.log(await wallet.getUnspentNotes(tree, tokenData));
}

main();
