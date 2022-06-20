import {Artifact, ArtifactConfig, FormattedVKey, VKeyJson} from '../types/types';

import artifacts from 'railgun-artifacts-node';
import {Contract} from 'ethers';

// TODO-TESTS: Lots of 'any' in this file.

/**
 * Formats vkey for solidity input
 *
 * @param vkey - verification key to format
 * @returns formatted vkey
 */
export const formatVKey = (vkey: VKeyJson): FormattedVKey => {
  return {
    artifactsIPFSHash: '',
    alpha1: {
      x: BigInt(vkey.vk_alpha_1[0]),
      y: BigInt(vkey.vk_alpha_1[1]),
    },
    beta2: {
      x: [BigInt(vkey.vk_beta_2[0][1]), BigInt(vkey.vk_beta_2[0][0])],
      y: [BigInt(vkey.vk_beta_2[1][1]), BigInt(vkey.vk_beta_2[1][0])],
    },
    gamma2: {
      x: [BigInt(vkey.vk_gamma_2[0][1]), BigInt(vkey.vk_gamma_2[0][0])],
      y: [BigInt(vkey.vk_gamma_2[1][1]), BigInt(vkey.vk_gamma_2[1][0])],
    },
    delta2: {
      x: [BigInt(vkey.vk_delta_2[0][1]), BigInt(vkey.vk_delta_2[0][0])],
      y: [BigInt(vkey.vk_delta_2[1][1]), BigInt(vkey.vk_delta_2[1][0])],
    },
    ic: vkey.IC.map((icEl: string) => ({
      x: BigInt(icEl[0]),
      y: BigInt(icEl[1]),
    })),
  };
};

/**
 * Fetches artifact with formatted verification key
 *
 * @param numNullifiers - nullifier count
 * @param numCommitments - commitment count
 * @returns artifact
 */
export const getKeys = (numNullifiers: number, numCommitments: number): Artifact => {
  const artifact = artifacts[numNullifiers][numCommitments];
  artifact.solidityVkey = formatVKey(artifact.vkey);
  return artifact;
};

/**
 * Returns all artifacts available
 *
 * @returns nullifier -> commitments -> keys
 */
export const allArtifacts = (): Artifact[][] => {
  return artifacts.map((x: any) =>
    x.map((y: any) => {
      // eslint-disable-next-line no-param-reassign
      y.solidityVkey = formatVKey(y.vkey);
      return y;
    })
  );
};

/**
 * Loads all available artifacts into verifier contract
 *
 * @param verifierContract - verifier Contract
 */
export const loadAllArtifacts = async (verifierContract: Contract) => {
  const artifactsList = allArtifacts();

  let nullifiers = 1;

  for (nullifiers; nullifiers < artifactsList.length; nullifiers += 1) {
    let commitments = 1;

    if (artifactsList[nullifiers]) {
      for (commitments; commitments < artifactsList[nullifiers].length; commitments += 1) {
        if (artifactsList[nullifiers][commitments]) {
          await verifierContract.setVerificationKey(
            nullifiers,
            commitments,
            artifactsList[nullifiers][commitments].solidityVkey
          );
        }
      }
    }
  }
};

/**
 * Returns all artifact configs as single array
 *
 * @returns {Array<object>} artifact configs
 */
export const artifactConfigs = () => {
  const artifactsList: ArtifactConfig[] = [];
  allArtifacts().forEach((x, nullifiers) => {
    x.forEach((y, commitments) => {
      artifactsList.push({nullifiers, commitments});
    });
  });
  return artifactsList;
};
