import {utils} from 'ethers';
import {SNARK_SCALAR_FIELD} from './constants';
import {
  BoundParams,
  CommitmentCiphertext,
  Proof,
  ProverInputs,
  PublicInputs,
  SerializedTransaction,
} from '../types/types';
import {Note, WithdrawNote} from './note';
import {genRandomPrivateKey} from './babyjubjub';
import {MerkleTree} from './merkletree';
import {prove} from './prover';
import {getKeys} from './snarkKeys';

const abiCoder = utils.defaultAbiCoder;

const dummyProof = {
  solidity: {
    a: {x: 0n, y: 0n},
    b: {x: [0n, 0n], y: [0n, 0n]},
    c: {x: 0n, y: 0n},
  },
};

/**
 * Hash bound parameters struct
 *
 * @param boundParams - bound parameters struct
 * @returns hash
 */
export const hashBoundParams = (boundParams: BoundParams): bigint => {
  const hash = utils.keccak256(
    abiCoder.encode(
      [
        'tuple(uint16 treeNumber, uint8 withdraw, address adaptContract, bytes32 adaptParams, tuple(uint256[4] ciphertext, uint256[2] ephemeralKeys, uint256[] memo)[] commitmentCiphertext) _boundParams',
      ],
      [boundParams]
    )
  );

  return BigInt(hash) % SNARK_SCALAR_FIELD;
};

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
export const formatInputs = (
  merkletree: MerkleTree,
  withdraw: bigint,
  adaptContract: string,
  adaptParams: string,
  notesIn: Note[],
  notesOut: (Note | WithdrawNote)[],
  commitmentCiphertext: CommitmentCiphertext[]
): ProverInputs => {
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
  const nullifiers = notesIn.map(note => {
    const merkleProof = merkletree.generateProof(note.hash);
    return note.getNullifier(merkleProof.indices);
  });
  const commitmentsOut = notesOut.map(note => note.hash);

  // PRIVATE INPUTS
  const {token} = notesIn[0];
  const publicKey = notesIn[0].spendingPublicKey;
  const signature = notesIn[0].sign(merkleRoot, boundParamsHash, nullifiers, commitmentsOut);
  const randomIn = notesIn.map(note => note.random);
  const valueIn = notesIn.map(note => note.value);
  const pathElements = notesIn.map(note => {
    const merkleProof = merkletree.generateProof(note.hash);
    return merkleProof.elements;
  });
  const leavesIndices = notesIn.map(note => {
    const merkleProof = merkletree.generateProof(note.hash);
    return merkleProof.indices;
  });
  const {nullifyingKey} = notesIn[0];
  const npkOut = notesOut.map(note => note.notePublicKey);
  const valueOut = notesOut.map(note => note.value);

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
};

/**
 * Formats inputs for submitting to chain
 *
 * @param proof - snark proof
 * @param merkletree - merkle tree to get inclusion proofs from
 * @param withdraw - withdraw field
 * (0 for no withdraw, 1 for withdraw, 2 for withdraw with override allowed)
 * @param adaptContract - adapt contract to lock transaction to (0 if no lock)
 * @param adaptParams - parameter field for use by adapt module
 * @paramNote notesIn - transaction inputs
 * @param notesOut - transaction outputs
 * @param withdrawPreimage - withdraw note preimage
 * @param overrideOutput - redirect output to address
 * @param commitmentCiphertext - commitment ciphertext
 * @returns inputs
 */
export const formatPublicInputs = (
  proof: Proof,
  merkletree: MerkleTree,
  withdraw: bigint,
  adaptContract: string,
  adaptParams: string,
  notesIn: Note[],
  notesOut: (Note | WithdrawNote)[],
  withdrawPreimage: WithdrawNote,
  overrideOutput: string,
  commitmentCiphertext: CommitmentCiphertext[]
): PublicInputs => {
  const merkleRoot = merkletree.root;
  const treeNumber = BigInt(merkletree.treeNumber);
  const nullifiers = notesIn.map(note => {
    const merkleProof = merkletree.generateProof(note.hash);
    return note.getNullifier(merkleProof.indices);
  });
  const commitments = notesOut.map(note => note.hash);

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
};

/**
 * Generates and proves transaction
 *
 * @param merkletree - merkle tree to get inclusion proofs from
 * @param withdraw - withdraw field
 * (0 for no withdraw, 1 for withdraw, 2 for withdraw with override allowed)
 * @param adaptContract - adapt contract to lock transaction to (0 if no lock)
 * @param adaptParams - parameter field for use by adapt module
 * @param notesIn - transaction inputs
 * @param notesOut - transaction outputs
 * @param withdrawPreimage - withdraw note preimage
 * @param overrideOutput - redirect output to address
 * @returns transaction
 */
export const transact = async (
  merkletree: MerkleTree,
  withdraw: bigint,
  adaptContract: string,
  adaptParams: string,
  notesIn: Note[],
  notesOut: (Note | WithdrawNote)[],
  withdrawPreimage: WithdrawNote,
  overrideOutput: string
): Promise<SerializedTransaction> => {
  const artifact = getKeys(notesIn.length, notesOut.length);

  const ciphertextLength = withdraw === 0n ? notesOut.length : notesOut.length - 1;

  const commitmentCiphertext = new Array(ciphertextLength).fill(1).map(() => ({
    ciphertext: new Array(4).fill(1).map(() => genRandomPrivateKey()),
    ephemeralKeys: new Array(2).fill(1).map(() => genRandomPrivateKey()),
    memo: new Array(Math.floor(Math.random() * 10)).fill(1).map(() => genRandomPrivateKey()),
  }));

  const inputs = formatInputs(
    merkletree,
    withdraw,
    adaptContract,
    adaptParams,
    notesIn,
    notesOut,
    commitmentCiphertext
  );

  const proof = await prove(artifact, inputs);

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
    commitmentCiphertext
  );

  return publicInputs;
};

/**
 * Generates with dummy proof
 *
 * @param merkletree - merkle tree to get inclusion proofs from
 * @param withdraw - withdraw field
 * (0 for no withdraw, 1 for withdraw, 2 for withdraw with override allowed)
 * @param adaptContract - adapt contract to lock transaction to (0 if no lock)
 * @param adaptParams - parameter field for use by adapt module
 * @param notesIn - transaction inputs
 * @param notesOut - transaction outputs
 * @param withdrawPreimage - withdraw note preimage
 * @param overrideOutput - redirect output to address
 * @returns transaction
 */
export const dummyTransact = async (
  merkletree: MerkleTree,
  withdraw: bigint,
  adaptContract: string,
  adaptParams: string,
  notesIn: Note[],
  notesOut: (Note | WithdrawNote)[],
  withdrawPreimage: WithdrawNote,
  overrideOutput: string
): Promise<SerializedTransaction> => {
  const proof = dummyProof;

  const ciphertextLength = withdraw === 0n ? notesOut.length : notesOut.length - 1;

  const commitmentCiphertext: CommitmentCiphertext[] = new Array(ciphertextLength)
    .fill(1)
    .map(() => ({
      ciphertext: new Array(4).fill(1).map(() => genRandomPrivateKey()),
      ephemeralKeys: new Array(2).fill(1).map(() => genRandomPrivateKey()),
      memo: new Array(Math.floor(Math.random() * 10)).fill(1).map(() => genRandomPrivateKey()),
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
    commitmentCiphertext
  );
  return publicInputs;
};

/**
 * Get base and fee amount
 *
 * @param amount - Amount to calculate for
 * @param isInclusive - Whether the amount passed in is inclusive of the fee
 * @param feeBP - Fee basis points
 * @returns base, fee
 */
export const getFee = (amount: bigint, isInclusive: boolean, feeBP: bigint): [bigint, bigint] => {
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
};
