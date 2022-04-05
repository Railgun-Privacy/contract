/* eslint-disable no-bitwise */
const crypto = require('crypto');
const { babyJub, poseidon } = require('circomlib');

/**
 * Generates random babyjubjub privateKey
 *
 * @returns {bigint} private key
 */
function genRandomPrivateKey() {
  const seedHashString = poseidon([
    BigInt(`0x${crypto.randomBytes(32).toString('hex')}`),
  ]).toString(16);
  const seedHash = Buffer.from(seedHashString.padStart(64, '0'), 'hex');

  // Prune seed hash
  seedHash[0] &= 0xf8;
  seedHash[31] &= 0x7f;
  seedHash[31] |= 0x40;

  // Convert from little endian bytes to number and shift right
  return BigInt(`0x${seedHash.toString('hex')}`) >> 3n;
}

/**
 * Convert babyjubjub private ley to public key
 *
 * @param {bigint} privateKey - babyjubjub private key
 * @returns {Array<bigint>} public key
 */
function privateKeyToPublicKey(privateKey) {
  return babyJub.mulPointEscalar(babyJub.Base8, privateKey);
}

module.exports = {
  genRandomPrivateKey,
  privateKeyToPublicKey,
};
