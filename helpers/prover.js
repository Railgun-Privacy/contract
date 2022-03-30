const snarkjs = require('snarkjs');
const artifacts = require('./snarkKeys');

async function prove(nullifiersCount, commitmentsCount, inputs) {
  const artifact = artifacts.getKeys(nullifiersCount, commitmentsCount);
  const { proof } = await snarkjs.groth16.fullProve(inputs, artifact.wasm, artifact.zkey);
  return proof;
}

module.exports = prove;
