const ethers = require('ethers');

const abiCoder = ethers.utils.defaultAbiCoder;

/**
 * Get adapt params field
 *
 * @param {object[]} transactions - bound parameters struct
 * @param {string} additionalData - 
 * @returns {string} adapt params
 */
function getAdaptParams(transactions, additionalData) {
  transactions.

  return ethers.utils.keccak256(abiCoder.encode([
    'tuple(uint16 treeNumber, uint8 withdraw, address adaptContract, bytes32 adaptParams, tuple(uint256[4] ciphertext, uint256[2] ephemeralKeys, uint256[] memo)[] commitmentCiphertext) _boundParams',
  ], [boundParams]));
}

function getRelayAdaptParams() {
  
}

module.exports = {
  getAdaptParams,
  getRelayAdaptParams,
};
