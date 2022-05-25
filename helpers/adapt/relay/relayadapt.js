const ethers = require('ethers');

const abiCoder = ethers.utils.defaultAbiCoder;

/**
 * Get adapt params field
 *
 * @param {object[]} transactions - transactions
 * @param {string} additionalData - additional byte data to add to adapt params
 * @returns {string} adapt params
 */
function getAdaptParams(transactions, additionalData) {
  const firstNullifiers = transactions.map((transaction) => transaction.nullifiers[0]);

  return ethers.utils.keccak256(abiCoder.encode(
    ['uint256[]', 'uint256', 'bytes'],
    [firstNullifiers, transactions.length, additionalData],
  ));
}

/**
 * Get relay adapt params field
 *
 * @param {object[]} transactions - transactions
 * @param {bigint} random - random value
 * @param {boolean} requireSuccess - require success on calls
 * @param {object[]} calls - calls list
 * @returns {string} adapt params
 */
function getRelayAdaptParams(transactions, random, requireSuccess, calls) {
  const additionalData = abiCoder.encode(
    ['uint256', 'bool', 'tuple(address to, bytes data, uint256 value)[] calls'],
    [random, requireSuccess, calls],
  );

  return getAdaptParams(transactions, additionalData);
}

/**
 * Strips all unnecessary fields from populated transactions
 *
 * @param {object[]} calls - calls list
 * @returns {object[]} formatted calls
 */
function formatCalls(calls) {
  return calls.map((call) => ({
    to: call.to,
    data: call.data,
    value: call.value || 0n,
  }));
}

module.exports = {
  getAdaptParams,
  getRelayAdaptParams,
  formatCalls,
};
