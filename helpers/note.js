const { babyjub, poseidon, eddsa } = require('circomlib');
const ethers = require('ethers');
const babyjubjubHelper = require('./babyjubjub');

class Note {
  constructor(babyjubjubPrivateKey, nullifyingKey, value, random, token) {
    this.babyjubjubPrivateKey = babyjubjubPrivateKey;
    this.nullifyingKey = nullifyingKey;
    this.value = value;
    this.random = random;
    this.token = token;
  }

  get masterPublicKey() {
    const masterPrivateKey = babyjub.F.mul(this.babyjubjubPrivateKey, this.nullifyingKey);
    return babyjubjubHelper.privateKeyToPublicKey(masterPrivateKey);
  }

  get packed() {
    const sign = babyjub.F.lt(this.masterPublicKey[0], babyjub.F.zero);

    const abiCoder = ethers.utils.defaultAbiCoder;

    return abiCoder.encode([
      sign,
      this.value,
      this.random,
    ], [
      'bool',
      'uint120',
      'uint128',
    ]);
  }

  get hash() {
    const y = this.masterPublicKey[1];

    return poseidon([
      y,
      this.packed,
      this.token,
    ]);
  }

  getNullifier(leafIndex) {
    return poseidon([
      leafIndex,
      this.nullifyingKey,
      this.random,
    ]);
  }

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
