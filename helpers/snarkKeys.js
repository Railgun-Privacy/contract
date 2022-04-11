const artifacts = require('railgun-artifacts-node');

/**
 * Formats vkey for solidity input
 *
 * @param {object} vkey - verification key to format
 * @returns {object} formatted vkey
 */
function formatVKey(vkey) {
  return {
    artifactsIPFSHash: '',
    alpha1: {
      x: BigInt(vkey.vk_alpha_1[0]),
      y: BigInt(vkey.vk_alpha_1[1]),
    },
    beta2: {
      x: [
        BigInt(vkey.vk_beta_2[0][1]),
        BigInt(vkey.vk_beta_2[0][0]),
      ],
      y: [
        BigInt(vkey.vk_beta_2[1][1]),
        BigInt(vkey.vk_beta_2[1][0]),
      ],
    },
    gamma2: {
      x: [
        BigInt(vkey.vk_gamma_2[0][1]),
        BigInt(vkey.vk_gamma_2[0][0]),
      ],
      y: [
        BigInt(vkey.vk_gamma_2[1][1]),
        BigInt(vkey.vk_gamma_2[1][0]),
      ],
    },
    delta2: {
      x: [
        BigInt(vkey.vk_delta_2[0][1]),
        BigInt(vkey.vk_delta_2[0][0]),
      ],
      y: [
        BigInt(vkey.vk_delta_2[1][1]),
        BigInt(vkey.vk_delta_2[1][0]),
      ],
    },
    ic: vkey.IC.map((icEl) => ({
      x: BigInt(icEl[0]),
      y: BigInt(icEl[1]),
    })),
  };
}

/**
 * Fetches artifact with formatted verification key
 *
 * @param {number} nullifiers - nullifier count
 * @param {number} commitments - commitment count
 * @returns {object} keys
 */
function getKeys(nullifiers, commitments) {
  const artifact = artifacts[nullifiers][commitments];
  artifact.solidityVkey = formatVKey(artifact.vkey);

  return artifact;
}

/**
 * Returns all artifacts available
 *
 * @returns {Array<Array<object>>} nullifier -> commitments -> keys
 */
function allArtifacts() {
  return artifacts.map((x) => x.map((y) => {
    // eslint-disable-next-line no-param-reassign
    y.solidityVkey = formatVKey(y.vkey);
    return y;
  }));
}

module.exports = {
  formatVKey,
  getKeys,
  allArtifacts,
};
