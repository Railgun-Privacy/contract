const { ethers } = require('hardhat');
const relayAdapt = require('./relayadapt');
const babyjubjub = require('../../logic/babyjubjub');
const MerkleTree = require('../../logic/merkletree');
const { Note } = require('../../logic/note');
const transaction = require('../../logic/transaction');

async function main() {
  const spendingKey = babyjubjub.genRandomPrivateKey();
  const viewingKey = babyjubjub.genRandomPrivateKey();

  const tokenData = {
    tokenType: 0,
    tokenAddress: ethers.BigNumber.from(10).toHexString(),
    tokenSubID: 0,
  };

  const merkletree = new MerkleTree();

  const notes = new Array(12).fill(1).map(
    // eslint-disable-next-line no-loop-func
    () => new Note(
      spendingKey,
      viewingKey,
      10n ** 18n,
      babyjubjub.genRandomPoint(),
      BigInt(tokenData.tokenAddress),
    ),
  );

  merkletree.insertLeaves(notes.map((note) => note.hash));

  const tx = await transaction.dummyTransact(
    merkletree,
    0n,
    ethers.constants.AddressZero,
    ethers.constants.HashZero,
    notes,
    notes,
    new Note(0n, 0n, 0n, 0n, 0n),
    ethers.constants.AddressZero,
  );

  console.log(relayAdapt.getAdaptParams([tx], '0x'));
}

main();
