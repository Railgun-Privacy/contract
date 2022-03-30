/* eslint-disable no-bitwise */
const crypto = require('crypto');
const { babyjub, poseidon } = require('circomlib');

function genRandomPrivateKey() {
  const seedHash = poseidon([crypto.randomBytes()]);

  // Prune seed hash
  seedHash[0] &= 0xf8;
  seedHash[31] &= 0x7f;
  seedHash[31] |= 0x40;

  // Convert from little endian bytes to number and shift right
  return seedHash >> 3;
}

function privateKeyToPublicKey(privateKey) {
  return babyjub.mulPointEscalar(babyjub.Base8, privateKey);
}

module.exports = {
  genRandomPrivateKey,
  privateKeyToPublicKey,
};
