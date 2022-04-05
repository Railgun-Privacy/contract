const { poseidon, eddsa } = require('circomlib');
const babyjubjubHelper = require('./babyjubjub');

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
    return babyjubjubHelper.privateKeyToPublicKey(this.babyjubjubPrivateKey);
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

    // TODO: Fix signPoseidon call
    return eddsa.signPoseidon(this.babyjubjubPrivateKey, hash);
  }
}

module.exports = Note;
