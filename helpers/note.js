const { poseidon, eddsa } = require('circomlib');
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
    const babyJubJubPublicKey = babyjubjubHelper.privateKeyToPublicKey(this.babyjubjubPrivateKey);
    return poseidon([babyJubJubPublicKey, this.nullifyingKey]);
  }

  get notePublicKey() {
    return poseidon([this.masterPublicKey, this.random]);
  }

  get hash() {
    return poseidon([
      this.notePublicKey,
      this.token,
      this.value,
    ]);
  }

  getNullifier(leafIndex) {
    return poseidon([
      this.nullifyingKey,
      leafIndex,
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
