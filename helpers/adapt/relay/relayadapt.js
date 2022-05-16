const ethers = require('ethers');

const abiCoder = ethers.utils.defaultAbiCoder;

/**
 * Get adapt params field
 *
 * @param {object[]} transactions - bound parameters struct
 * @param {string} additionalData - additional byte data to add to adapt params
 * @returns {string} adapt params
 */
function getAdaptParams(transactions, additionalData) {
  console.log(transactions);
  const firstNullifiers = transactions.map((transaction) => transaction.nullifiers[0]);

  console.log(firstNullifiers);

  // return ethers.utils.keccak256(abiCoder.encode([
  //   'tuple(uint16 treeNumber, uint8 withdraw, address adaptContract, bytes32 adaptParams, tuple(uint256[4] ciphertext, uint256[2] ephemeralKeys, uint256[] memo)[] commitmentCiphertext) _boundParams',
  // ], [boundParams]));
}

function getRelayAdaptParams() {
  
}

module.exports = {
  getAdaptParams,
  getRelayAdaptParams,
};
