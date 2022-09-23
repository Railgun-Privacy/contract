import { ethers } from 'hardhat';
import { ProofBundle, prove, SolidityProof } from './prover';
import { CommitmentCiphertext, Note, TokenData, WithdrawNote } from './note';
import { eddsa, hash } from '../global/crypto';
import { hexStringToArray, arrayToBigInt, bigIntToArray } from '../global/bytes';
import { SNARK_SCALAR_FIELD } from '../global/constants';
import { MerkleTree } from './merkletree';
import { getKeys } from './artifacts';

export enum WithdrawType {
  NONE = 0,
  WITHDRAW = 1,
  REDIRECT = 2,
}

export interface BoundParams {
  treeNumber: number;
  withdraw: WithdrawType;
  adaptContract: string;
  adaptParams: Uint8Array;
  commitmentCiphertext: CommitmentCiphertext[];
}

export interface PublicInputs {
  proof: SolidityProof;
  merkleRoot: Uint8Array;
  nullifiers: Uint8Array[];
  commitments: Uint8Array[];
  boundParams: BoundParams;
  withdrawPreimage: {
    npk: Uint8Array;
    token: TokenData;
    value: bigint;
  };
  overrideOutput: string;
}

export interface CircuitInputs {
  // PUBLIC INPUTS
  merkleRoot: bigint;
  boundParamsHash: bigint;
  nullifiers: bigint[];
  commitmentsOut: bigint[];

  // PRIVATE INPUTS
  token: bigint;
  publicKey: [bigint, bigint];
  signature: [bigint, bigint, bigint];
  randomIn: bigint[];
  valueIn: bigint[];
  pathElements: bigint[][];
  leavesIndices: number[];
  nullifyingKey: bigint;
  npkOut: bigint[];
  valueOut: bigint[];
}

const dummyProof: ProofBundle = {
  javascript: {
    pi_a: [0n, 0n],
    pi_b: [
      [0n, 0n],
      [0n, 0n],
    ],
    pi_c: [0n, 0n],
    protocol: 'groth16',
  },
  solidity: {
    a: { x: 0n, y: 0n },
    b: { x: [0n, 0n], y: [0n, 0n] },
    c: { x: 0n, y: 0n },
  },
};

/**
 * Hash bound parameters struct
 *
 * @param boundParams - bound parameters struct
 * @returns hash
 */
function hashBoundParams(boundParams: BoundParams): Uint8Array {
  // Encode bytes
  const encodedBytes = hexStringToArray(
    ethers.utils.defaultAbiCoder.encode(
      [
        'tuple(uint16 treeNumber, uint8 withdraw, address adaptContract, bytes32 adaptParams, tuple(uint256[4] ciphertext, uint256[2] ephemeralKeys, uint256[] memo)[] commitmentCiphertext) _boundParams',
      ],
      [boundParams],
    ),
  );

  // Keccak hash
  const prehash = arrayToBigInt(hash.keccak256(encodedBytes));

  // Mod by SNARK_SCALAR_FIELD and return
  return bigIntToArray(BigInt(prehash) % SNARK_SCALAR_FIELD, 32);
}

/**
 * Formats inputs for submitting to chain
 *
 * @param proof - snark proof
 * @param merkletree - merkle tree to get inclusion proofs from
 * @param withdraw - withdraw field
 * (0 for no withdraw, 1 for withdraw, 2 for withdraw with override allowed)
 * @param adaptContract - adapt contract to lock transaction to (0 if no lock)
 * @param adaptParams - parameter field for use by adapt module
 * @param notesIn - transaction inputs
 * @param notesOut - transaction outputs
 * @param overrideOutput - redirect output to address
 * @param commitmentCiphertext - commitment ciphertext
 * @returns inputs
 */
async function formatPublicInputs(
  proof: ProofBundle,
  merkletree: MerkleTree,
  withdraw: WithdrawType,
  adaptContract: string,
  adaptParams: Uint8Array,
  notesIn: Note[],
  notesOut: (Note | WithdrawNote)[],
  overrideOutput: string,
  commitmentCiphertext: CommitmentCiphertext[],
): Promise<PublicInputs> {
  // Get Merkle Root
  const merkleRoot = merkletree.root;

  // Get tree number
  const treeNumber = merkletree.treeNumber;

  // Loop through each note in and get nullifier
  const nullifiers = await Promise.all(
    notesIn.map(async (note) => {
      // Get merkle proof
      const merkleProof = merkletree.generateProof(await note.getHash());

      // Generate nullifier from merkle proof indicies
      return note.getNullifier(merkleProof.indices);
    }),
  );

  // Loop through notes out and calculate hash
  const commitments = await Promise.all(notesOut.map((note) => note.getHash()));

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
      npk: await notesOut[notesOut.length - 1].getNotePublicKey(),
      token: notesOut[notesOut.length - 1].tokenData,
      value: notesOut[notesOut.length - 1].value,
    },
    overrideOutput,
  };
}

/**
 * Formats inputs for prover
 *
 * @param merkletree - merkle tree to get inclusion proofs from
 * @param withdraw - withdraw field
 * @param adaptContract - adapt contract to lock transaction to (0 if no lock)
 * @param adaptParams - parameter field for use by adapt module
 * @param notesIn - transaction inputs
 * @param notesOut - transaction outputs
 * @param commitmentCiphertext - commitment ciphertext
 * @returns inputs
 */
async function formatCircuitInputs(
  merkletree: MerkleTree,
  withdraw: WithdrawType,
  adaptContract: string,
  adaptParams: Uint8Array,
  notesIn: Note[],
  notesOut: (Note | WithdrawNote)[],
  commitmentCiphertext: CommitmentCiphertext[],
): Promise<CircuitInputs> {
  // PUBLIC INPUTS
  // Get Merkle Root
  const merkleRoot = merkletree.root;

  // Get tree number
  const treeNumber = merkletree.treeNumber;

  // Get bound parameters hash
  const boundParamsHash = hashBoundParams({
    treeNumber,
    withdraw,
    adaptContract,
    adaptParams,
    commitmentCiphertext,
  });

  // Loop through each note in and get nullifier
  const nullifiers = await Promise.all(
    notesIn.map(async (note) => {
      // Get merkle proof
      const merkleProof = merkletree.generateProof(await note.getHash());

      // Generate nullifier from merkle proof indicies
      return note.getNullifier(merkleProof.indices);
    }),
  );

  // Loop through notes out and calculate hash
  const commitmentsOut = await Promise.all(notesOut.map((note) => note.getHash()));

  // PRIVATE INPUTS
  const token = await notesIn[0].getTokenID();
  const publicKey = await notesIn[0].getSpendingPublicKey();
  const signature = await notesIn[0].sign(merkleRoot, boundParamsHash, nullifiers, commitmentsOut);
  const randomIn = notesIn.map((note) => note.random);
  const valueIn = notesIn.map((note) => note.value);
  const pathElements = await Promise.all(
    notesIn.map(async (note) => {
      const merkleProof = merkletree.generateProof(await note.getHash());
      return merkleProof.elements;
    }),
  );
  const leavesIndices = await Promise.all(
    notesIn.map(async (note) => {
      const merkleProof = merkletree.generateProof(await note.getHash());
      return merkleProof.indices;
    }),
  );
  const nullifyingKey = await notesIn[0].getNullifyingKey();
  const npkOut = await Promise.all(notesOut.map((note) => note.getNotePublicKey()));
  const valueOut = notesOut.map((note) => note.value);

  return {
    // PUBLIC INPUTS
    merkleRoot: arrayToBigInt(merkleRoot),
    boundParamsHash: arrayToBigInt(boundParamsHash),
    nullifiers: nullifiers.map(arrayToBigInt),
    commitmentsOut: commitmentsOut.map(arrayToBigInt),

    // PRIVATE INPUTS
    token: arrayToBigInt(token),
    publicKey: publicKey.map(arrayToBigInt) as [bigint, bigint],
    signature: signature.map(arrayToBigInt) as [bigint, bigint, bigint],
    randomIn: randomIn.map(arrayToBigInt),
    valueIn,
    pathElements: pathElements.map((el) => el.map(arrayToBigInt)),
    leavesIndices,
    nullifyingKey: arrayToBigInt(nullifyingKey),
    npkOut: npkOut.map(arrayToBigInt),
    valueOut,
  };
}

/**
 * Generates transaction with dummy proof
 *
 * @param merkletree - merkle tree to get inclusion proofs from
 * @param withdraw - withdraw field
 * (0 for no withdraw, 1 for withdraw, 2 for withdraw with override allowed)
 * @param  adaptContract - adapt contract to lock transaction to (0 if no lock)
 * @param adaptParams - parameter field for use by adapt module
 * @param  notesIn - transaction inputs
 * @param notesOut - transaction outputs
 * @param overrideOutput - redirect output to address
 * @returns transaction
 */
async function dummyTransact(
  merkletree: MerkleTree,
  withdraw: WithdrawType,
  adaptContract: string,
  adaptParams: Uint8Array,
  notesIn: Note[],
  notesOut: (Note | WithdrawNote)[],
  overrideOutput: string,
) {
  const ciphertextLength = withdraw === 0 ? notesOut.length : notesOut.length - 1;

  const commitmentCiphertext = new Array(ciphertextLength).fill(1).map(() => ({
    ciphertext: new Array(4).fill(1).map(() => eddsa.genRandomPrivateKey()) as [
      Uint8Array,
      Uint8Array,
      Uint8Array,
      Uint8Array,
    ],
    ephemeralKeys: new Array(2).fill(1).map(() => eddsa.genRandomPrivateKey()) as [
      Uint8Array,
      Uint8Array,
    ],
    memo: new Array(Math.floor(Math.random() * 10)).fill(1).map(() => eddsa.genRandomPrivateKey()),
  }));

  const publicInputs = formatPublicInputs(
    dummyProof,
    merkletree,
    withdraw,
    adaptContract,
    adaptParams,
    notesIn,
    notesOut,
    overrideOutput,
    commitmentCiphertext,
  );

  return publicInputs;
}

/**
 * Generates and proves transaction
 *
 * @param merkletree - merkle tree to get inclusion proofs from
 * @param withdraw - withdraw field
 * (0 for no withdraw, 1 for withdraw, 2 for withdraw with override allowed)
 * @param  adaptContract - adapt contract to lock transaction to (0 if no lock)
 * @param adaptParams - parameter field for use by adapt module
 * @param  notesIn - transaction inputs
 * @param notesOut - transaction outputs
 * @param overrideOutput - redirect output to address
 * @returns transaction
 */
 async function transact(
  merkletree: MerkleTree,
  withdraw: WithdrawType,
  adaptContract: string,
  adaptParams: Uint8Array,
  notesIn: Note[],
  notesOut: (Note | WithdrawNote)[],
  overrideOutput: string,
) {
  const artifact = getKeys(notesIn.length, notesOut.length);

  const ciphertextLength = withdraw === 0 ? notesOut.length : notesOut.length - 1;

  const commitmentCiphertext = new Array(ciphertextLength).fill(1).map(() => ({
    ciphertext: new Array(4).fill(1).map(() => eddsa.genRandomPrivateKey()) as [
      Uint8Array,
      Uint8Array,
      Uint8Array,
      Uint8Array,
    ],
    ephemeralKeys: new Array(2).fill(1).map(() => eddsa.genRandomPrivateKey()) as [
      Uint8Array,
      Uint8Array,
    ],
    memo: new Array(Math.floor(Math.random() * 10)).fill(1).map(() => eddsa.genRandomPrivateKey()),
  }));

  const inputs = await formatCircuitInputs(
    merkletree,
    withdraw,
    adaptContract,
    adaptParams,
    notesIn,
    notesOut,
    commitmentCiphertext,
  );

  const proof = await prove(
    artifact,
    inputs,
  );

  const publicInputs = await formatPublicInputs(
    proof,
    merkletree,
    withdraw,
    adaptContract,
    adaptParams,
    notesIn,
    notesOut,
    overrideOutput,
    commitmentCiphertext,
  );

  return publicInputs;
}

export { hashBoundParams, formatPublicInputs, formatCircuitInputs, dummyTransact, transact };
