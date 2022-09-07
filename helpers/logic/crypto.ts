import crypto from 'crypto';
import { toBigIntBE, toBigIntLE, toBufferBE } from '@trufflesuite/bigint-buffer';
import curve25519 from '@noble/ed25519';
import { blake3 } from '@noble/hashes/blake3';
import { XChaCha20 } from 'xchacha20-js';
import { buildEddsa, buildPoseidonOpt } from 'circomlibjs';

/* @todo FOR V2 SWITCH TO XCHACHA20 */

/**
 * Encrypts message with key
 *
 * @param key - encryption key (32 bytes)
 * @param message - message to encrypt
 * @returns encrypted bundle
 */
async function encryptXChaCha20(key: Buffer, message: Buffer): Promise<Buffer> {
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
 * @param key - encryption key
 * @param bundle - bundle to decrypt
 * @returns decrypted data
 */
async function decryptXChaCha20(key: Buffer, bundle: Buffer): Promise<Buffer> {
  // Deconstruct bundle
  const tag = bundle.subarray(0, 32);
  const nonce = bundle.subarray(32, 56);
  const ciphertext = bundle.subarray(56);

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
 * @param plaintext - plaintext to encrypt
 * @param key - key to encrypt with
 * @returns encrypted bundle
 */
function encryptAESGCM(plaintext: Buffer[], key: Buffer): Buffer[] {
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: 16,
  });

  const data = plaintext.map((block) => cipher.update(block));
  cipher.final();

  const tag = cipher.getAuthTag();

  return [Buffer.concat([iv, tag]), ...data];
}

/**
 * Decrypt encrypted bundle with AES-GCM-256
 *
 * @param ciphertext - encrypted bundle to decrypt
 * @param key - key to decrypt with
 * @returns plaintext
 */
function decryptAESGCM(ciphertext: Buffer[], key: Buffer): Buffer[] {
  const iv = ciphertext[0].subarray(0, 16);
  const tag = ciphertext[0].subarray(16, 32);
  const encryptedData = ciphertext.slice(1);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
    authTagLength: 16,
  });

  decipher.setAuthTag(tag);

  // Loop through ciphertext and decrypt then return
  const data = encryptedData.slice().map((block) => decipher.update(block));
  decipher.final();

  return data;
}

/**
 * Adjusts random value for curve25519
 *
 * @param random - random value
 * @returns adjusted random
 */
function adjustRandom(random: Buffer): Buffer {
  const randomHash = crypto.createHash('sha256').update(random).digest();
  // eslint-disable-next-line no-bitwise
  randomHash[0] &= 248;
  // eslint-disable-next-line no-bitwise
  randomHash[31] &= 127;
  // eslint-disable-next-line no-bitwise
  randomHash[31] |= 64;
  return toBufferBE(toBigIntBE(randomHash) % curve25519.CURVE.n, 32);
}

/**
 * Generates ephemeral keys for note encryption
 *
 * @param random - randomness for ephemeral keys
 * @param senderPrivKey - Private key of sender
 * @param receiverPubKey - public key of receiver
 * @returns ephemeral keys
 */
function ephemeralKeysGen(random: Buffer, senderPrivKey: Buffer, receiverPubKey: Buffer): Buffer[] {
  const r = adjustRandom(random);
  const S = curve25519.Point.fromHex(senderPrivKey);
  const R = curve25519.Point.fromHex(receiverPubKey);
  const rS = S.multiply(toBigIntBE(r)).toRawBytes();
  const rR = R.multiply(toBigIntBE(r)).toRawBytes();
  return [Buffer.from(rS), Buffer.from(rR)];
}

const poseidonPromise = buildPoseidonOpt();

/**
 * Poseidon Hash wrapper to output bigint representations
 *
 * @param inputs - inputs to hash
 * @returns hash
 */
async function poseidon(inputs: bigint[]): Promise<bigint> {
  const poseidonBuild = await poseidonPromise;
  return toBigIntLE(Buffer.from(poseidonBuild.F.fromMontgomery(poseidonBuild(inputs))));
}

const eddsaPromise = buildEddsa();

const eddsa = {
  /**
   * Generates random eddsa-babyjubjub privateKey
   *
   * @returns private key
   */
  genRandomPrivateKey(): Buffer {
    return crypto.randomBytes(32);
  },

  /**
   * Convert eddsa-babyjubjub private key to public key
   *
   * @param privateKey - babyjubjub private key
   * @returns public key
   */
  async prv2pub(privateKey: Buffer): Promise<Buffer[]> {
    const eddsaBuild = await eddsaPromise;
    return eddsaBuild.prv2pub(privateKey).map((el) => toBufferBE(el, 32));
  },

  /**
   * Generates a random babyJubJub point
   *
   * @returns random point
   */
  async genRandomPoint(): Promise<Buffer> {
    return toBufferBE(await poseidon([BigInt(`0x${crypto.randomBytes(32).toString('hex')}`)]), 32);
  },
};

export {
  encryptXChaCha20,
  decryptXChaCha20,
  encryptAESGCM,
  decryptAESGCM,
  ephemeralKeysGen,
  poseidon,
  eddsa,
};
