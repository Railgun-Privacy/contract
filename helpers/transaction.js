const ethers = require('ethers');
const artifacts = require('./snarkKeys');
const prover = require('./prover');
const { SNARK_SCALAR_FIELD } = require('./constants');
const MerkleTree = require('./merkletree');
const Note = require('./note');

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
  solidity: {
    a: { x: 0n, y: 0n },
    b: { x: [0n, 0n], y: [0n, 0n] },
    c: { x: 0n, y: 0n },
  },
};

/**
 * Hash bound parameters struct
 *
 * @param {object} boundParams - bound parameters struct
 * @returns {bigint} hash
 */
function hashBoundParams(boundParams) {
  const hash = ethers.utils.keccak256(abiCoder.encode([
    'tuple(uint16 treeNumber, uint8 withdraw, address adaptContract, bytes32 adaptParams, tuple(uint256[4] ciphertext, uint256[2] ephemeralKeys, bytes32[] memo)[] commitmentCiphertext) _boundParams',
  ], [boundParams]));

  return BigInt(hash) % SNARK_SCALAR_FIELD;
}

/**
 * Formats inputs for prover
 *
 * @param {MerkleTree} merkletree - merkle tree to get inclusion proofs from
 * @param {bigint} withdraw - withdraw field
 * @param {string} adaptContract - adapt contract to lock transaction to (0 if no lock)
 * @param {bigint} adaptParams - parameter field for use by adapt module
 * @param {Array<Note>} notesIn - transaction inputs
 * @param {Array<Note>} notesOut - transaction outputs
 * @returns {object} inputs
 */
function formatInputs(
  merkletree,
  withdraw,
  adaptContract,
  adaptParams,
  notesIn,
  notesOut,
) {
  // PUBLIC INPUTS
  const merkleRoot = merkletree.root;
  const { treeNumber } = merkletree;
  const boundParamsHash = hashBoundParams({
    treeNumber,
    withdraw,
    adaptContract,
    adaptParams,
    commitmentCiphertext: [],
  });
  const nullifiers = notesIn.map((note) => {
    const merkleProof = merkletree.generateProof(note.hash);
    return note.getNullifier(merkleProof.indices);
  });
  const commitmentsOut = notesOut.forEach((note) => note.hash);

  // PRIVATE INPUTS
  const { token } = notesIn[0];
  const publicKey = notesIn[0].spendingPublicKey;
  const signature = notesIn[0].sign(
    merkleRoot,
    boundParamsHash,
    nullifiers,
    commitmentsOut,
  );
  const randomIn = notesIn.map((note) => note.random);
  const valueIn = notesIn.map((note) => note.value);
  const pathElements = notesIn.map((note) => {
    const merkleProof = merkletree.generateProof(note.hash);
    return merkleProof.elements;
  });
  const leavesIndices = notesIn.map((note) => {
    const merkleProof = merkletree.generateProof(note.hash);
    return merkleProof.indices;
  });
  const { nullifyingKey } = notesIn[0];
  const npkOut = notesOut.map((note) => note.notePublicKey);
  const valueOut = notesOut.map();

  return {
    // PUBLIC INPUTS
    merkleRoot,
    treeNumber,
    boundParamsHash,
    nullifiers,
    commitmentsOut,

    // PRIVATE INPUTS
    token,
    publicKey,
    signature,
    randomIn,
    valueIn,
    pathElements,
    leavesIndices,
    nullifyingKey,
    npkOut,
    valueOut,
  };
}

/**
 * Formats inputs for submitting to chain
 *
 * @param {object} proof - snark proof
 * @param {MerkleTree} merkletree - merkle tree to get inclusion proofs from
 * @param {bigint} withdraw - withdraw field
 * (0 for no withdraw, 1 for withdraw, 2 for withdraw with override allowed)
 * @param {string} adaptContract - adapt contract to lock transaction to (0 if no lock)
 * @param {bigint} adaptParams - parameter field for use by adapt module
 * @param {Array<Note>} notesIn - transaction inputs
 * @param {Array<Note>} notesOut - transaction outputs
 * @param {Note} withdrawPreimage - withdraw note preimage
 * @param {string} overrideOutput - redirect output to address
 * @returns {object} inputs
 */
function formatPublicInputs(
  proof,
  merkletree,
  withdraw,
  adaptContract,
  adaptParams,
  notesIn,
  notesOut,
  withdrawPreimage,
  overrideOutput,
) {
  const merkleRoot = merkletree.root;
  const { treeNumber } = merkletree;
  const nullifiers = notesIn.map((note) => {
    const merkleProof = merkletree.generateProof(note.hash);
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

/**
 * Generates and proves transaction
 *
 * @param {MerkleTree} merkletree - merkle tree to get inclusion proofs from
 * @param {bigint} withdraw - withdraw field
 * (0 for no withdraw, 1 for withdraw, 2 for withdraw with override allowed)
 * @param {string} adaptContract - adapt contract to lock transaction to (0 if no lock)
 * @param {bigint} adaptParams - parameter field for use by adapt module
 * @param {Array<Note>} notesIn - transaction inputs
 * @param {Array<Note>} notesOut - transaction outputs
 * @param {Note} withdrawPreimage - withdraw note preimage
 * @param {string} overrideOutput - redirect output to address
 * @returns {object} transaction
 */
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

  return publicInputs;
}

/**
 * Generates with dummy proof
 *
 * @param {MerkleTree} merkletree - merkle tree to get inclusion proofs from
 * @param {bigint} withdraw - withdraw field
 * (0 for no withdraw, 1 for withdraw, 2 for withdraw with override allowed)
 * @param {string} adaptContract - adapt contract to lock transaction to (0 if no lock)
 * @param {bigint} adaptParams - parameter field for use by adapt module
 * @param {Array<Note>} notesIn - transaction inputs
 * @param {Array<Note>} notesOut - transaction outputs
 * @param {Note} withdrawPreimage - withdraw note preimage
 * @param {string} overrideOutput - redirect output to address
 * @returns {object} transaction
 */
async function dummyTransact(
  merkletree,
  withdraw,
  adaptContract,
  adaptParams,
  notesIn,
  notesOut,
  withdrawPreimage,
  overrideOutput,
) {
  const proof = dummyProof;

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

  return publicInputs;
}

module.exports = {
  dummyProof,
  hashBoundParams,
  formatInputs,
  transact,
  dummyTransact,
};