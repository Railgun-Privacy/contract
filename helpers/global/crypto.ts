import crypto from 'crypto';
import * as ed25519 from '@noble/ed25519';
import { buildEddsa, buildPoseidonOpt } from 'circomlibjs';
import { arrayToBigInt, bigIntToArray, arrayToByteLength } from './bytes';

const aes = {
  gcm: {
    /**
     * Encrypt plaintext with AES-GCM-256
     *
     * @param plaintext - plaintext to encrypt
     * @param key - key to encrypt with
     * @returns encrypted bundle
     */
    encrypt(plaintext: Uint8Array[], key: Uint8Array): Uint8Array[] {
      const iv = new Uint8Array(crypto.randomBytes(16));

      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {
        authTagLength: 16,
      });

      const data = plaintext
        .map((block) => cipher.update(block))
        .map((block) => new Uint8Array(block));
      cipher.final();

      const tag = cipher.getAuthTag();

      return [new Uint8Array([...iv, ...tag]), ...data];
    },

    /**
     * Decrypt encrypted bundle with AES-GCM-256
     *
     * @param ciphertext - encrypted bundle to decrypt
     * @param key - key to decrypt with
     * @returns plaintext
     */
    decrypt(ciphertext: Uint8Array[], key: Uint8Array): Uint8Array[] {
      const iv = ciphertext[0].subarray(0, 16);
      const tag = ciphertext[0].subarray(16, 32);
      const encryptedData = ciphertext.slice(1);

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
        authTagLength: 16,
      });

      decipher.setAuthTag(tag);

      // Loop through ciphertext and decrypt then return
      const data = encryptedData.slice().map((block) => new Uint8Array(decipher.update(block)));
      decipher.final();

      return data;
    },
  },
};

/**
 * Adjusts random value for curve25519
 *
 * @param random - random value
 * @returns adjusted random
 */
function adjustRandom(random: Uint8Array): Uint8Array {
  const randomHash = new Uint8Array(crypto.createHash('sha256').update(random).digest());
  randomHash[0] &= 248;
  randomHash[31] &= 127;
  randomHash[31] |= 64;
  return bigIntToArray(arrayToBigInt(randomHash) % ed25519.CURVE.n, 32);
}

/**
 * Generates ephemeral keys for note encryption
 *
 * @param random - randomness for ephemeral keys
 * @param senderPrivKey - Private key of sender
 * @param receiverPubKey - public key of receiver
 * @returns ephemeral keys
 */
function ephemeralKeysGen(
  random: Uint8Array,
  senderPrivKey: Uint8Array,
  receiverPubKey: Uint8Array,
): Uint8Array[] {
  const r = adjustRandom(random);
  const S = ed25519.Point.fromHex(senderPrivKey);
  const R = ed25519.Point.fromHex(receiverPubKey);
  const rS = S.multiply(arrayToBigInt(r)).toRawBytes();
  const rR = R.multiply(arrayToBigInt(r)).toRawBytes();
  return [rS, rR];
}

const poseidonPromise = buildPoseidonOpt();

/**
 * Poseidon Hash wrapper to output bigint representations
 *
 * @param inputs - inputs to hash
 * @returns hash
 */
async function poseidon(inputs: Uint8Array[]): Promise<Uint8Array> {
  const poseidonBuild = await poseidonPromise;
  const result = poseidonBuild.F.fromMontgomery(
    poseidonBuild(inputs.map((input) => poseidonBuild.F.toMontgomery(input.reverse()))),
  );

  return arrayToByteLength(result, 32).reverse();
}

const eddsaPromise = buildEddsa();

const eddsa = {
  /**
   * Generates random eddsa-babyjubjub privateKey
   *
   * @returns private key
   */
  genRandomPrivateKey(): Uint8Array {
    return new Uint8Array(crypto.randomBytes(32));
  },

  /**
   * Convert eddsa-babyjubjub private key to public key
   *
   * @param privateKey - babyjubjub private key
   * @returns public key
   */
  async prv2pub(privateKey: Uint8Array): Promise<Uint8Array[]> {
    const eddsaBuild = await eddsaPromise;
    return eddsaBuild.prv2pub(privateKey).map((el) => bigIntToArray(el, 32));
  },

  /**
   * Generates a random babyJubJub point
   *
   * @returns random point
   */
  genRandomPoint(): Promise<Uint8Array> {
    return poseidon([eddsa.genRandomPrivateKey()]);
  },

  async signPoseidon(key: Uint8Array, message: Uint8Array) {
    const eddsaBuild = await eddsaPromise;

    const sig = eddsaBuild.signPoseidon(key, message);

    return sig;
  },
};

export { aes, ephemeralKeysGen, poseidon, eddsa };
