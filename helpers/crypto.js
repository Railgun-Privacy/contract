const crypto = require('crypto');
const { blake3 } = require('@noble/hashes/blake3');
const { XChaCha20 } = require('xchacha20-js');

/**
 * Encrypts message with key
 *
 * @param {Buffer} key - encryption key (32 bytes)
 * @param {Buffer} message - message to encrypt
 * @returns {Buffer} encrypted bundle
 */
async function encrypt(key, message) {
  // Get nonce
  const nonce = crypto.randomBytes(24);

  // Encrypt data
  const xchacha20 = new XChaCha20();
  const ciphertext = await xchacha20.encrypt(message, nonce, key);

  // Get tag (Buffer.from to copy key as noble-hashes zeros out the buffer)
  const tag = Buffer.from(blake3(ciphertext, { key: Buffer.from(key) }));

  // Prepend nonce and tag to ciphertext
  const bundle = Buffer.concat([tag, nonce, ciphertext]);

  return bundle;
}

/**
 * Decrypts encrypted bundle with key
 *
 * @param {Buffer} key - encryption key
 * @param {Buffer} bundle - bundle to decrypt
 * @returns {Buffer} decrypted data
 */
async function decrypt(key, bundle) {
  // Deconstruct bundle
  const tag = bundle.slice(0, 32);
  const nonce = bundle.slice(32, 56);
  const ciphertext = bundle.slice(56);

  // Authenticate tag (Buffer.from to copy key as noble-hashes zeros out the buffer)
  const computedTag = Buffer.from(blake3(ciphertext, { key: Buffer.from(key) }));
  if (Buffer.compare(tag, computedTag) !== 0) throw new Error('Encrypted with a different key');

  // Decrypt data
  const xchacha20 = new XChaCha20();
  const plaintext = await xchacha20.decrypt(ciphertext, nonce, key);

  return plaintext;
}

module.exports = {
  encrypt,
  decrypt,
};
