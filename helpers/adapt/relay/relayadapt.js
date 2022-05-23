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

function getRelayAdaptParams() {
  
}

module.exports = {
  getAdaptParams,
  getRelayAdaptParams,
};
