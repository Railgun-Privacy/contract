import { toBufferBE, toBigIntBE } from '@trufflesuite/bigint-buffer';
import { poseidon, eddsa } from '../global/crypto';

class Note {
  spendingKey: Uint8Array;

  viewingKey: Uint8Array;

  value: bigint;

  random: Uint8Array;

  token: Uint8Array;

  /**
   * Create Note object
   *
   * @param spendingKey - spending private key
   * @param viewingKey - viewing key
   * @param value - note value
   * @param random - note random field
   * @param token - note token
   */
  constructor(spendingKey: Uint8Array, viewingKey: Uint8Array, value: bigint, random: Uint8Array, token: Uint8Array) {
    this.spendingKey = spendingKey;
    this.viewingKey = viewingKey;
    this.value = value;
    this.random = random;
    this.token = token;
  }

  /**
   * Get note nullifying key
   *
   * @returns nullifying key
   */
  nullifyingKey(): Promise<Uint8Array> {
    return poseidon([this.viewingKey]);
  }

  /**
   * Get note spending public key
   *
   * @returns spending public key
   */
  spendingPublicKey() {
    return eddsa.prv2pub(this.spendingKey);
  }

  /**
   * Get note master public key
   *
   * @returns master public key
   */
  async masterPublicKey() {
    return poseidon([...(await this.spendingPublicKey()), await this.nullifyingKey()]);
  }

  /**
   * Get note public key
   *
   * @returns {bigint} note public key
   */
  get notePublicKey() {
    return poseidon([this.masterPublicKey, this.random]);
  }

  /**
   * Get note hash
   *
   * @returns {bigint} hash
   */
  get hash() {
    return poseidon([this.notePublicKey, this.token, this.value]);
  }

  /**
   * Calculate nullifier
   *
   * @param {bigint} leafIndex - leaf index of note
   * @returns {bigint} nullifier
   */
  getNullifier(leafIndex) {
    return poseidon([this.nullifyingKey, leafIndex]);
  }

  /**
   * Sign a transaction
   *
   * @param {bigint} merkleRoot - transaction merkle root
   * @param {bigint} boundParamsHash - transaction bound parameters hash
   * @param {Array<bigint>} nullifiers - transaction nullifiers
   * @param {Array<bigint>} commitmentsOut - transaction commitments
   * @returns {object} signature
   */
  sign(merkleRoot, boundParamsHash, nullifiers, commitmentsOut) {
    const hash = poseidon([
      merkleRoot,
      boundParamsHash,
      ...nullifiers,
      ...commitmentsOut,
    ]);

    const key = Buffer.from(
      ethers.BigNumber.from(this.spendingKey).toHexString().slice(2),
      'hex',
    );

    const sig = eddsa.signPoseidon(key, hash);

    return [...sig.R8, sig.S];
  }

  /**
   * Encrypts note random
   *
   * @returns {Promise<Buffer[]>} encrypted random data
   */
  async encryptRandom() {
    return cryptoHelper.encryptAESGCM(
      [bigintBuffer.toBufferBE(this.random, 16)],
      bigintBuffer.toBufferBE(this.viewingKey, 32),
    );
  }
}

class WithdrawNote {
  /**
   * Create Note object
   *
   * @param {bigint} withdrawAddress - address to withdraw to
   * @param {bigint} value - note value
   * @param {bigint} token - note token
   */
  constructor(withdrawAddress, value, token) {
    this.withdrawAddress = withdrawAddress;
    this.value = value;
    this.token = token;
  }

  /**
   * Return withdraw address as npk
   *
   * @returns {bigint} npk
   */
  get notePublicKey() {
    return this.withdrawAddress;
  }

  /**
   * Get note hash
   *
   * @returns {bigint} hash
   */
  get hash() {
    return poseidon([this.withdrawAddress, this.token, this.value]);
  }
}

export {
  Note,
  WithdrawNote,
};
