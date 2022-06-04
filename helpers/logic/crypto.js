const crypto = require('crypto');
const bigintBuffer = require('bigint-buffer');
const curve25519 = require('@noble/ed25519');
const { blake3 } = require('@noble/hashes/blake3');
const { XChaCha20 } = require('xchacha20-js');

/* @todo FOR V2 SWITCH TO XCHACHA20 */

/**
 * Encrypts message with key
 *
 * @param {Buffer} key - encryption key (32 bytes)
 * @param {Buffer} message - message to encrypt
 * @returns {Buffer} encrypted bundle
 */
async function encryptXChaCha20(key, message) {
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
async function decryptXChaCha20(key, bundle) {
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

/* END TODO */

/**
 * Encrypt plaintext with AES-GCM-256
 *
 * @param {Buffer[]} plaintext - plaintext to encrypt
 * @param {Buffer} key - key to encrypt with
 * @returns {Buffer[]} encrypted bundle
 */
async function encryptAESGCM(plaintext, key) {
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: 16,
  });

  const data = plaintext
    .map((block) => cipher.update(block));
  cipher.final();

  const tag = cipher.getAuthTag();

  return [Buffer.concat([iv, tag]), ...data];
}

/**
 * Decrypt encrypted bundle with AES-GCM-256
 *
 * @param {Buffer[]} ciphertext - encrypted bundle to decrypt
 * @param {Buffer} key - key to decrypt with
 * @returns {Buffer[]} plaintext
 */
async function decryptAESGCM(ciphertext, key) {
  const iv = ciphertext[0].slice(0, 16);
  const tag = ciphertext[0].slice(16, 32);
  const encryptedData = ciphertext.slice(1);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
    authTagLength: 16,
  });

  decipher.setAuthTag(tag);

  // Loop through ciphertext and decrypt then return
  const data = encryptedData.slice()
    .map((block) => decipher.update(block));
  decipher.final();

  return data;
}

/**
 * Adjusts random value for curve25519
 *
 * @param {bigint} random - random value
 * @returns {bigint} adjusted random
 */
function adjustRandom(random) {
  const randomArray = crypto.createHash('sha256').update(
    bigintBuffer.toBufferBE(random, 32),
  ).digest();
  // eslint-disable-next-line no-bitwise
  randomArray[0] &= 248;
  // eslint-disable-next-line no-bitwise
  randomArray[31] &= 127;
  // eslint-disable-next-line no-bitwise
  randomArray[31] |= 64;
  return BigInt(`0x${randomArray.toString('hex')}`) % curve25519.CURVE.n;
}

/**
 * Generates ephemeral keys for note encryption
 *
 * @param {bigint} random - randomness for ephemeral keys
 * @param {bigint} senderPrivKey - Private key of sender
 * @param {bigint[]} receiverPubKey - public key of receiver
 * @returns {}
 */
async function ephemeralKeysGen(random, senderPrivKey, receiverPubKey) {
  const r = adjustRandom(random);
  const S = curve25519.Point.fromHex(senderPrivKey);
  const R = curve25519.Point.fromHex(receiverPubKey);
  const rS = S.multiply(r).toRawBytes();
  const rR = R.multiply(r).toRawBytes();
  return [rS, rR];
}

module.exports = {
  encryptXChaCha20,
  decryptXChaCha20,
  encryptAESGCM,
  decryptAESGCM,
  ephemeralKeysGen,
};
