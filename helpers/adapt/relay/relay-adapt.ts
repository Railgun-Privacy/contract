import {utils, BigNumber, PopulatedTransaction} from 'ethers';
import {SerializedTransaction} from '../../types/types';

const abiCoder = utils.defaultAbiCoder;

/**
 * Get adapt params field
 *
 * @param transactions - transactions
 * @param additionalData - additional byte data to add to adapt params
 * @returns adapt params
 */
export const getAdaptParams = (transactions: SerializedTransaction[], additionalData: string) => {
  const firstNullifiers = transactions.map(transaction => transaction.nullifiers[0]);

  return utils.keccak256(
    abiCoder.encode(
      ['uint256[]', 'uint256', 'bytes'],
      [firstNullifiers, transactions.length, additionalData]
    )
  );
};

/**
 * Get relay adapt params field
 *
 * @param transactions - transactions
 * @param random - random value
 * @param requireSuccess - require success on calls
 * @param minGas - minimum amount of gas to be supplied to transaction
 * @param calls - calls list
 * @returns adapt params
 */
export const getRelayAdaptParams = (
  transactions: SerializedTransaction[],
  random: bigint,
  requireSuccess: boolean,
  minGas: bigint,
  calls: PopulatedTransaction[]
): string => {
  const additionalData = abiCoder.encode(
    ['uint256', 'bool', 'uint256', 'tuple(address to, bytes data, uint256 value)[] calls'],
    [random, requireSuccess, minGas, calls]
  );

  return getAdaptParams(transactions, additionalData);
};

/**
 * Strips all unnecessary fields from populated transactions
 *
 * @param calls - calls list
 * @returns formatted calls
 */
export const formatCalls = (calls: PopulatedTransaction[]): PopulatedTransaction[] => {
  return calls.map(call => ({
    to: call.to,
    data: call.data,
    value: call.value ?? BigNumber.from(0),
  }));
};
