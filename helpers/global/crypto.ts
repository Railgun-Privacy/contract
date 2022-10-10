import crypto from 'crypto';
import * as nobleED25519 from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256, keccak_512 } from '@noble/hashes/sha3';
import { buildEddsa, buildPoseidonOpt } from 'circomlibjs';
import { arrayToBigInt, bigIntToArray, arrayToByteLength } from './bytes';

/**
 * Gets random bytes
 *
 * @param length - random bytes length
 * @returns random bytes
 */
function randomBytes(length: number) {
  return new Uint8Array(crypto.randomBytes(length));
}

const poseidonPromise = buildPoseidonOpt();

const hash = {
  /**
   * Poseidon hash
   *
   * @param inputs - inputs to hash
   * @returns hash
   */
  poseidon: async (inputs: Uint8Array[]): Promise<Uint8Array> => {
    const poseidonBuild = await poseidonPromise;

    // Convert inputs to LE montgomery representation then convert back to standard at end
    const result = poseidonBuild.F.fromMontgomery(
      poseidonBuild(
        inputs.map((input) => poseidonBuild.F.toMontgomery(new Uint8Array(input).reverse())),
      ),
    );

    return arrayToByteLength(result, 32).reverse();
  },

  /**
   * SHA256 hash
   *
   * @param input - input to hash
   * @returns hash
   */
  sha256: (input: Uint8Array): Uint8Array => {
    return sha256(input);
  },

  /**
   * Keccak256 hash
   *
   * @param input - input to hash
   * @returns hash
   */
  keccak256: (input: Uint8Array): Uint8Array => {
    return keccak_256(input);
  },

  /**
   * Keccak5125 hash
   *
   * @param input - input to hash
   * @returns hash
   */
  keccak512: (input: Uint8Array): Uint8Array => {
    return keccak_512(input);
  },
};

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
      const iv = randomBytes(16);

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

const ed25519 = {
  railgunKeyExchange: {
    /**
     * Converts seed to curve scalar
     *
     * @param seed - seed to convert
     * @returns scalar
     */
    seedToScalar(seed: Uint8Array): Uint8Array {
      // TODO: switch to 512 bit hash length as per FIPS-186
      const seedHash = hash.sha256(seed);

      // Prune buffer to X25519 LE encoded integer
      // This is not needed but is left for backwards compatibility with
      // Railgun notes that have performed this in the past
      // As this reduces entropy it is not ideal, but we consider it
      // acceptable for now
      // TODO: implement corrected algorithm in next note format update
      seedHash[0] &= 248;
      seedHash[31] &= 127;
      seedHash[31] |= 64;

      // Return mod n to fit to curve
      // This should be (arrayToBigInt(randomHash) % nobleED25519.CURVE.n - 1n) + 1n
      // but is implemented this way for backwards compatibility
      // It will fail for any inputs that are a multiple of CURVE.n, (16/2^256 possibilities)
      // We rely on sha256 preimage resistance to prevent a malicious actor
      // from being able to trigger this failure condition
      // TODO: implement corrected algorithm in next note format update
      return bigIntToArray(arrayToBigInt(seedHash) % nobleED25519.CURVE.n, 32);
    },

    /**
     * Generates ephemeral keys for note encryption
     *
     * @param random - randomness for ephemeral keys
     * @param senderPrivKey - Private key of sender
     * @param receiverPubKey - public key of receiver
     * @returns ephemeral keys
     */
    ephemeralKeysGen(
      random: Uint8Array,
      senderPrivKey: Uint8Array,
      receiverPubKey: Uint8Array,
    ): Uint8Array[] {
      const r = ed25519.railgunKeyExchange.seedToScalar(random);
      const S = nobleED25519.Point.fromHex(senderPrivKey);
      const R = nobleED25519.Point.fromHex(receiverPubKey);
      const rS = S.multiply(arrayToBigInt(r)).toRawBytes();
      const rR = R.multiply(arrayToBigInt(r)).toRawBytes();
      return [rS, rR];
    },
  },
};

const eddsaPromise = buildEddsa();

const edBabyJubJub = {
  /**
   * Generates random eddsa-babyjubjub privateKey
   *
   * @returns private key
   */
  genRandomPrivateKey(): Uint8Array {
    return randomBytes(32);
  },

  /**
   * Convert eddsa-babyjubjub private key to public key
   *
   * @param privateKey - babyjubjub private key
   * @returns public key
   */
  async prv2pub(privateKey: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
    const eddsaBuild = await eddsaPromise;

    // Derive key
    const key = eddsaBuild
      .prv2pub(privateKey)
      .map((element) => eddsaBuild.F.fromMontgomery(element).reverse()) as [Uint8Array, Uint8Array];

    return key;
  },

  /**
   * Generates a random babyJubJub point
   *
   * @returns random point
   */
  genRandomPoint(): Promise<Uint8Array> {
    return hash.poseidon([randomBytes(32)]);
  },

  /**
   * Creates eddsa-babyjubjub signature with poseidon hash
   *
   * @param key - private key
   * @param message - message to sign
   * @returns signature
   */
  async signPoseidon(
    key: Uint8Array,
    message: Uint8Array,
  ): Promise<[Uint8Array, Uint8Array, Uint8Array]> {
    const eddsaBuild = await eddsaPromise;

    // Get montgomery representation
    const montgomery = eddsaBuild.F.toMontgomery(new Uint8Array(message).reverse());

    // Sign
    const sig = eddsaBuild.signPoseidon(key, montgomery);

    // Convert R8 elements from montgomery and to BE
    const r8 = sig.R8.map((element) => eddsaBuild.F.fromMontgomery(element).reverse());

    return [r8[0], r8[1], bigIntToArray(sig.S, 32)];
  },
};

export { randomBytes, hash, aes, ed25519, edBabyJubJub };
