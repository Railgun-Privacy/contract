const snarkjs = require('snarkjs');

/**
 * Formats javascript proof to solidity proof
 *
 * @param {object} proof - javascript proof
 * @returns {object} solidity proof
 */
function formatProof(proof) {
  return {
    a: { x: BigInt(proof.pi_a[0]), y: BigInt(proof.pi_a[1]) },
    b: {
      x: [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      y: [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    },
    c: { x: BigInt(proof.pi_c[0]), y: BigInt(proof.pi_c[1]) },
  };
}

/**
 * Generate proof for a circuit
 *
 * @param {object} artifact - circuit artifact
 * @param {object} inputs - circuit inputs
 * @returns {object} proof
 */
async function prove(artifact, inputs) {
  const { proof } = await snarkjs.groth16.fullProve(inputs, artifact.wasm, artifact.zkey);
  return {
    javascript: proof,
    solidity: formatProof(proof),
  };
}

module.exports = {
  formatProof,
  prove,
};
