const artifacts = require('railgun-artifacts-node');
const { ethers } = require('hardhat');

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

/**
 * Loads all available artifacts into verifier contract
 *
 * @param {ethers.Contract} verifierContract - verifier Contract
 */
async function loadAllArtifacts(verifierContract) {
  const artifactsList = allArtifacts();

  let nullifiers = 1;

  for (nullifiers; nullifiers < artifactsList.length; nullifiers += 1) {
    let commitments = 1;

    if (artifactsList[nullifiers]) {
      for (commitments; commitments < artifactsList[nullifiers].length; commitments += 1) {
        if (artifactsList[nullifiers][commitments]) {
          // eslint-disable-next-line no-await-in-loop
          await verifierContract.setVerificationKey(
            nullifiers,
            commitments,
            artifactsList[nullifiers][commitments].solidityVkey,
          );
        }
      }
    }
  }
}

/**
 * Returns all artifact configs as single array
 *
 * @returns {Array<object>} artifact configs
 */
function artifactConfigs() {
  const artifactsList = [];
  allArtifacts().forEach((x, nullifiers) => {
    x.forEach((y, commitments) => {
      artifactsList.push({ nullifiers, commitments });
    });
  });
  return artifactsList;
}

module.exports = {
  formatVKey,
  getKeys,
  allArtifacts,
  loadAllArtifacts,
  artifactConfigs,
};
