/* eslint-disable no-bitwise */
const crypto = require('crypto');
const { ethers } = require('hardhat');
const { babyJub, eddsa, poseidon } = require('circomlibjs');

/**
 * Generates random babyjubjub privateKey
 *
 * @returns {bigint} private key
 */
function genRandomPrivateKey() {
  return BigInt(`0x${crypto.randomBytes(32).toString('hex')}`);
}

/**
 * Convert babyjubjub private ley to public key
 *
 * @param {bigint} privateKey - babyjubjub private key
 * @returns {Array<bigint>} public key
 */
function privateKeyToPublicKey(privateKey) {
  return eddsa.prv2pub(
    Buffer.from(ethers.BigNumber.from(privateKey).toHexString().slice(2), 'hex')
  );
}

module.exports = {
  genRandomPrivateKey,
  privateKeyToPublicKey,
};
