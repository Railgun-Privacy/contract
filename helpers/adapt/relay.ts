import { ethers } from 'ethers';
import { hexStringToArray } from '../global/bytes';
import { hash } from '../global/crypto';
import { MerkleTree } from '../logic/merkletree';
import { Note, UnshieldNote } from '../logic/note';
import { dummyTransact, PublicInputs, transact, UnshieldType } from '../logic/transaction';

export interface Call {
  to: string;
  data: Uint8Array;
  value: bigint;
}

export interface ActionData {
  random: Uint8Array;
  requireSuccess: boolean;
  minGasLimit: bigint;
  calls: Call[];
}

export interface ProverRelayAdaptNonSharedInputs {
  minGasPrice: bigint;
  unshield: UnshieldType;
  chainID: bigint;
  adaptContract: string;
  notesIn: Note[];
  notesOut: (Note | UnshieldNote)[];
}

/**
 * Get adapt params to set for transactions
 *
 * @param transactions - transactions to use for nullifiers input
 * @param actionData - action data to include
 * @returns adapt params
 */
function getAdaptParams(transactions: PublicInputs[], actionData: ActionData): Uint8Array {
  // Get first nullifiers
  const nullifiers = transactions.map((transaction) => transaction.nullifiers);

  // Get hash preimage
  const preimage = hexStringToArray(
    ethers.utils.defaultAbiCoder.encode(
      [
        'bytes32[][] nullifiers',
        'uint256 transactionsLength',
        'tuple(bytes31 random, bool requireSuccess, uint256 minGasLimit, tuple(address to, bytes data, uint256 value)[] calls) actionData',
      ],
      [nullifiers, transactions.length, actionData],
    ),
  );

  // Return hash of preimage
  return hash.keccak256(preimage);
}

/**
 * Prove batch of transactions with correct adapt params field for relay adapt
 *
 * @param merkletree - merkle tree for proofs
 * @param actionData - actions for relay adapt to take
 * @param inputs - shared proof inputs
 * @returns proved transaction array
 */
async function transactWithAdaptParams(
  merkletree: MerkleTree,
  actionData: ActionData,
  inputs: ProverRelayAdaptNonSharedInputs[],
) {
  // Calculate unproved transactions with empty adapt params field
  const transactionsUnproved = await Promise.all(
    inputs.map((txInputs) =>
      dummyTransact(
        merkletree,
        txInputs.minGasPrice,
        txInputs.unshield,
        txInputs.chainID,
        txInputs.adaptContract,
        new Uint8Array(32),
        txInputs.notesIn,
        txInputs.notesOut,
      ),
    ),
  );

  // Calculate adapt params
  const adaptParams = getAdaptParams(transactionsUnproved, actionData);

  // Prove transactions with adapt params field
  return Promise.all(
    inputs.map((txInputs) =>
      transact(
        merkletree,
        txInputs.minGasPrice,
        txInputs.unshield,
        txInputs.chainID,
        txInputs.adaptContract,
        adaptParams,
        txInputs.notesIn,
        txInputs.notesOut,
      ),
    ),
  );
}

export { getAdaptParams, transactWithAdaptParams };
