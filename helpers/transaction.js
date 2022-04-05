const ethers = require('ethers');
const artifacts = require('./snarkKeys');
const prover = require('./prover');
const { SNARK_SCALAR_FIELD } = require('./constants');

const abiCoder = ethers.utils.defaultAbiCoder;

/*
Prover Inputs:

Public:
- merkleRoot
- boundParamsHash
- nullifiers
- commitmentsOut

Private:
- token
- publicSpendingKey[2]
- signature[3]
- packedIn[numIn]
- merkleTreeElements[numIn * treeDepth]
- merkleTreeIndicies[numIn]
- nullifyingKey[numIn]
- to[numOut] (master public key of recipient)
- packedOut[numOut]
*/

const dummyProof = {
  a: { x: 0n, y: 0n },
  b: { x: [0n, 0n], y: [0n, 0n] },
  c: { x: 0n, y: 0n },
};

function hashBoundParams(boundParams) {
  const hash = ethers.utils.keccak256(abiCoder.encode([
    'tuple(uint16 treeNumber, uint8 withdraw, address adaptContract, bytes32 adaptParams, tuple(uint256[4] ciphertext, uint256[2] ephemeralKeys, bytes32[] memo)[] commitmentCiphertext) _boundParams',
  ], [boundParams]));

  return BigInt(hash) % SNARK_SCALAR_FIELD;
}

function formatInputs(
  merkletree,
  withdraw,
  adaptContract,
  adaptParams,
  notesIn,
  notesOut,
) {
  const merkleRoot = merkletree.root;
  const { treeNumber } = merkletree;
  const boundParamsHash = hashBoundParams({
    treeNumber,
    withdraw,
    adaptContract,
    adaptParams,
    commitmentCiphertext: [],
  });
  const nullifiers = [];
  const commitmentsOut = [];
  const { token } = notesIn[0];

  notesIn.forEach((note) => {
    const merkleProof = merkletree.generateProof(note.hash);
  });

  notesOut.forEach((note) => {
    const merkleProof = merkletree.generateProof(note.hash);
  });

  return {
    merkleRoot,
    boundParamsHash,
    nullifiers,
    commitmentsOut,
  };
}

function formatPublicInputs(
  proof,
  merkleTree,
  withdraw,
  adaptContract,
  adaptParams,
  notesIn,
  notesOut,
  withdrawPreimage,
  overrideOutput,
) {
  const merkleRoot = merkleTree.root;
  const { treeNumber } = merkleTree;
  const nullifiers = notesIn.map((note) => {
    const merkleProof = merkleTree.generateProof(note.hash);
    return note.getNullifier(merkleProof.indicies);
  });
  const commitments = notesOut.map((note) => note.hash);

  return {
    proof: proof.solidity,
    merkleRoot,
    nullifiers,
    commitments,
    boundParams: {
      treeNumber,
      withdraw,
      adaptContract,
      adaptParams,
      commitmentCiphertext: [],
    },
    withdrawPreimage,
    overrideOutput,
  };
}

async function transact(
  merkletree,
  withdraw,
  adaptContract,
  adaptParams,
  notesIn,
  notesOut,
  withdrawPreimage,
  overrideOutput,
) {
  const artifact = artifacts.getKeys(notesIn.length, notesOut.length);

  const inputs = formatInputs(
    merkletree,
    withdraw,
    adaptContract,
    adaptParams,
    notesIn,
    notesOut,
  );

  const proof = prover.prove(
    artifact,
    inputs,
  );

  const publicInputs = formatPublicInputs(
    proof,
    merkletree,
    withdraw,
    adaptContract,
    adaptParams,
    notesIn,
    notesOut,
    withdrawPreimage,
    overrideOutput,
  );

  return {
    publicInputs,
    proof,
  };
}

module.exports = {
  dummyProof,
  hashBoundParams,
  formatInputs,
  transact,
};
