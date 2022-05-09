const ethers = require('ethers');

const abiCoder = ethers.utils.defaultAbiCoder;

/**
 * Get adapt params field
 *
 * @param {object[]} transactions - bound parameters struct
 * @returns {string} adapt params
 */
function getAdaptParams(transactions) {
  return ethers.utils.keccak256(abiCoder.encode([
    'tuple(uint16 treeNumber, uint8 withdraw, address adaptContract, bytes32 adaptParams, tuple(uint256[4] ciphertext, uint256[2] ephemeralKeys, uint256[] memo)[] commitmentCiphertext) _boundParams',
  ], [boundParams]));
}

function calculateAdaptParams() {
  
}

module.exports = {
  calculateAdaptParams,
};
