import crypto from 'crypto';
import {toBufferBE} from 'bigint-buffer';
import curve25519 from '@noble/ed25519';
import {blake3} from '@noble/hashes/blake3';
import {XChaCha20} from 'xchacha20-js';

/* @todo FOR V2 SWITCH TO XCHACHA20 */

/**
 * Encrypts message with key
 *
 * @param key - encryption key (32 bytes)
 * @param message - message to encrypt
 * @returns encrypted bundle
 */
export const encryptXChaCha20 = async (key: Buffer, message: Buffer): Promise<Buffer> => {
  // Get nonce
  const nonce = crypto.randomBytes(24);

  // Encrypt data
  const xchacha20 = new XChaCha20();
  const ciphertext = await xchacha20.encrypt(message, nonce, key);

  // Get tag (Buffer.from to copy key as noble-hashes zeros out the buffer)
  const tag = Buffer.from(blake3(ciphertext, {key: Buffer.from(key)}));

  // Prepend nonce and tag to ciphertext
  const bundle = Buffer.concat([tag, nonce, ciphertext]);

  return bundle;
};

/**
 * Decrypts encrypted bundle with key
 *
 * @param key - encryption key
 * @param bundle - bundle to decrypt
 * @returns decrypted data
 */
export const decryptXChaCha20 = async (key: Buffer, bundle: Buffer): Promise<Buffer> => {
  // Deconstruct bundle
  const tag = bundle.slice(0, 32);
  const nonce = bundle.slice(32, 56);
  const ciphertext = bundle.slice(56);

  // Authenticate tag (Buffer.from to copy key as noble-hashes zeros out the buffer)
  const computedTag = Buffer.from(blake3(ciphertext, {key: Buffer.from(key)}));
  if (Buffer.compare(tag, computedTag) !== 0) throw new Error('Encrypted with a different key');

  // Decrypt data
  const xchacha20 = new XChaCha20();
  const plaintext = await xchacha20.decrypt(ciphertext, nonce, key);

  return plaintext;
};

/* END TODO */

/**
 * Encrypt plaintext with AES-GCM-256
 *
 * @param plaintext - plaintext to encrypt
 * @param key - key to encrypt with
 * @returns encrypted bundle
 */
export const encryptAESGCM = async (plaintext: Buffer[], key: Buffer): Promise<Buffer[]> => {
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: 16,
  });

  const data = plaintext.map(block => cipher.update(block));
  cipher.final();

  const tag = cipher.getAuthTag();

  return [Buffer.concat([iv, tag]), ...data];
};

/**
 * Decrypt encrypted bundle with AES-GCM-256
 *
 * @param ciphertext - encrypted bundle to decrypt
 * @param key - key to decrypt with
 * @returns plaintext
 */
export const decryptAESGCM = async (ciphertext: Buffer[], key: Buffer): Promise<Buffer[]> => {
  const iv = ciphertext[0].slice(0, 16);
  const tag = ciphertext[0].slice(16, 32);
  const encryptedData = ciphertext.slice(1);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
    authTagLength: 16,
  });

  decipher.setAuthTag(tag);

  // Loop through ciphertext and decrypt then return
  const data = encryptedData.slice().map(block => decipher.update(block));
  decipher.final();

  return data;
};

/**
 * Adjusts random value for curve25519
 *
 * @param random - random value
 * @returns adjusted random
 */
function adjustRandom(random: bigint): bigint {
  const randomArray = crypto.createHash('sha256').update(toBufferBE(random, 32)).digest();
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
 * @param random - randomness for ephemeral keys
 * @param senderPrivKey - Private key of sender
 * @param receiverPubKey - public key of receiver
 * @returns [senderKey, receiverKey]
 */
export const ephemeralKeysGen = (
  random: bigint,
  senderPrivKey: string,
  receiverPubKey: string
): [Uint8Array, Uint8Array] => {
  const r = adjustRandom(random);
  const S = curve25519.Point.fromHex(senderPrivKey);
  const R = curve25519.Point.fromHex(receiverPubKey);
  const rS = S.multiply(r).toRawBytes();
  const rR = R.multiply(r).toRawBytes();
  return [rS, rR];
};
