const ethers = require('ethers');
const artifacts = require('./snarkKeys');
const prover = require('./prover');
const { SNARK_SCALAR_FIELD } = require('./constants');
const MerkleTree = require('./merkletree');
const { Note, WithdrawNote } = require('./note');
const babyjubjub = require('./babyjubjub');

const abiCoder = ethers.utils.defaultAbiCoder;

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
    'tuple(uint16 treeNumber, uint8 withdraw, address adaptContract, bytes32 adaptParams, tuple(uint256[4] ciphertext, uint256[2] ephemeralKeys, uint256[] memo)[] commitmentCiphertext) _boundParams',
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
 * @param {Array<Note | WithdrawNote>} notesOut - transaction outputs
 * @param {Array} commitmentCiphertext - commitment ciphertext
 * @returns {object} inputs
 */
function formatInputs(
  merkletree,
  withdraw,
  adaptContract,
  adaptParams,
  notesIn,
  notesOut,
  commitmentCiphertext,
) {
  // PUBLIC INPUTS
  const merkleRoot = merkletree.root;
  const treeNumber = BigInt(merkletree.treeNumber);
  const boundParamsHash = hashBoundParams({
    treeNumber,
    withdraw,
    adaptContract,
    adaptParams,
    commitmentCiphertext,
  });
  const nullifiers = notesIn.map((note) => {
    const merkleProof = merkletree.generateProof(note.hash);
    return note.getNullifier(merkleProof.indices);
  });
  const commitmentsOut = notesOut.map((note) => note.hash);

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
  const valueOut = notesOut.map((note) => note.value);

  return {
    // PUBLIC INPUTS
    merkleRoot,
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
 * @param {Array<Note | WithdrawNote>} notesOut - transaction outputs
 * @param {object} withdrawPreimage - withdraw note preimage
 * @param {string} overrideOutput - redirect output to address
 * @param {Array} commitmentCiphertext - commitment ciphertext
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
  commitmentCiphertext,
) {
  const merkleRoot = merkletree.root;
  const treeNumber = BigInt(merkletree.treeNumber);
  const nullifiers = notesIn.map((note) => {
    const merkleProof = merkletree.generateProof(note.hash);
    return note.getNullifier(merkleProof.indices);
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
      commitmentCiphertext,
    },
    withdrawPreimage: {
      npk: withdrawPreimage.notePublicKey,
      token: {
        tokenType: 0n,
        tokenAddress: `0x${withdrawPreimage.token.toString(16).padStart(40, '0')}`,
        tokenSubID: 0n,
      },
      value: withdrawPreimage.value,
    },
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
 * @param {Array<Note | WithdrawNote>} notesOut - transaction outputs
 * @param {object} withdrawPreimage - withdraw note preimage
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

  const ciphertextLength = withdraw === 0n ? notesOut.length : notesOut.length - 1;

  const commitmentCiphertext = new Array(ciphertextLength).fill(1).map(() => ({
    ciphertext: new Array(4).fill(1).map(() => babyjubjub.genRandomPrivateKey()),
    ephemeralKeys: new Array(2).fill(1).map(() => babyjubjub.genRandomPrivateKey()),
    memo: new Array(Math.floor(Math.random() * 10)).fill(1).map(
      () => babyjubjub.genRandomPrivateKey(),
    ),
  }));

  const inputs = formatInputs(
    merkletree,
    withdraw,
    adaptContract,
    adaptParams,
    notesIn,
    notesOut,
    commitmentCiphertext,
  );

  const proof = await prover.prove(
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
    commitmentCiphertext,
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
 * @param {Array<Note | WithdrawNote>} notesOut - transaction outputs
 * @param {WithdrawNote} withdrawPreimage - withdraw note preimage
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

  const ciphertextLength = withdraw === 0n ? notesOut.length : notesOut.length - 1;

  const commitmentCiphertext = new Array(ciphertextLength).fill(1).map(() => ({
    ciphertext: new Array(4).fill(1).map(() => babyjubjub.genRandomPrivateKey()),
    ephemeralKeys: new Array(2).fill(1).map(() => babyjubjub.genRandomPrivateKey()),
    memo: new Array(Math.floor(Math.random() * 10)).fill(1).map(
      () => babyjubjub.genRandomPrivateKey(),
    ),
  }));

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
    commitmentCiphertext,
  );
  return publicInputs;
}

/**
 * Get base and fee amount
 *
 * @param {bigint} amount - Amount to calculate for
 * @param {boolean} isInclusive - Whether the amount passed in is inclusive of the fee
 * @param {bigint} feeBP - Fee basis points
 * @returns {Array<bigint>} base, fee
 */
function getFee(amount, isInclusive, feeBP) {
  const BASIS_POINTS = 10000n;
  let base;
  let fee;

  if (isInclusive) {
    base = amount - (amount * feeBP) / BASIS_POINTS;
    fee = amount - base;
  } else {
    base = amount;
    fee = (BASIS_POINTS * base) / (BASIS_POINTS - feeBP) - base;
  }

  return [base, fee];
}

module.exports = {
  dummyProof,
  hashBoundParams,
  formatInputs,
  transact,
  dummyTransact,
  getFee,
};
