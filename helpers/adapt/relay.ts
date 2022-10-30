import { ethers } from 'ethers';
import { hexStringToArray } from '../global/bytes';
import { hash } from '../global/crypto';
import { PublicInputs } from '../logic/transaction';

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

export { getAdaptParams };
