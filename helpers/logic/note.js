/* eslint-disable max-classes-per-file */
const { ethers } = require('hardhat');
const { poseidon, eddsa } = require('circomlibjs');
const babyjubjubHelper = require('./babyjubjub');
const cryptoHelper = require('./crypto');

class Note {
  /**
   * Create Note object
   *
   * @param {bigint} spendingKey - spending private key
   * @param {bigint} viewingKey - viewing key
   * @param {bigint} value - note value
   * @param {bigint} random - note random field
   * @param {bigint} token - note token
   */
  constructor(spendingKey, viewingKey, value, random, token) {
    this.spendingKey = spendingKey;
    this.viewingKey = viewingKey;
    this.value = value;
    this.random = random;
    this.token = token;
  }

  /**
   * Get note nullifying key
   *
   * @returns {bigint} nullifying key
   */
  get nullifyingKey() {
    return poseidon([this.viewingKey]);
  }

  /**
   * Get note spending public key
   *
   * @returns {bigint} spending public key
   */
  get spendingPublicKey() {
    return babyjubjubHelper.privateKeyToPublicKey(this.spendingKey);
  }

  /**
   * Get note master public key
   *
   * @returns {bigint} master public key
   */
  get masterPublicKey() {
    return poseidon([...this.spendingPublicKey, this.nullifyingKey]);
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
    return poseidon([
      this.notePublicKey,
      this.token,
      this.value,
    ]);
  }

  /**
   * Calculate nullifier
   *
   * @param {bigint} leafIndex - leaf index of note
   * @returns {bigint} nullifier
   */
  getNullifier(leafIndex) {
    return poseidon([
      this.nullifyingKey,
      leafIndex,
    ]);
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
  sign(
    merkleRoot,
    boundParamsHash,
    nullifiers,
    commitmentsOut,
  ) {
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
   * @returns {Buffer[]} encrypted random data
   */
  async encryptRandom() {
    return cryptoHelper.encryptAESGCM([this.random], this.viewingKey);
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
    return poseidon([
      this.withdrawAddress,
      this.token,
      this.value,
    ]);
  }
}

module.exports = {
  Note,
  WithdrawNote,
};
