const { poseidon, eddsa } = require('circomlib');
const babyjubjubHelper = require('./babyjubjub');

class Note {
  /**
   * Create Note object
   *
   * @param {bigint} babyjubjubPrivateKey - spending private key
   * @param {bigint} viewingKey - viewing key
   * @param {bigint} value - note value
   * @param {bigint} random - note random field
   * @param {bigint} token - note token
   */
  constructor(babyjubjubPrivateKey, viewingKey, value, random, token) {
    this.babyjubjubPrivateKey = babyjubjubPrivateKey;
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
   * Get note master public key
   *
   * @returns {bigint} master public key
   */
  get masterPublicKey() {
    const babyJubJubPublicKey = babyjubjubHelper.privateKeyToPublicKey(this.babyjubjubPrivateKey);
    return poseidon([...babyJubJubPublicKey, this.nullifyingKey]);
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

    return eddsa.signPoseidon(this.babyjubjubPrivateKey, hash);
  }
}

module.exports = Note;
