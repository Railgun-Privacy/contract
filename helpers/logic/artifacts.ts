import artifacts from 'railgun-artifacts-node';
import type { Artifact, VKey } from 'railgun-artifacts-node';

export interface SolidityVkey {
  artifactsIPFSHash: string,
  alpha1: {
    x: bigint,
    y: bigint,
  },
  beta2: {
    x: bigint[],
    y: bigint[],
  },
  gamma2: {
    x: bigint[],
    y: bigint[],
  },
  delta2: {
    x: bigint[],
    y: bigint[],
  },
  ic: ({ x: bigint, y: bigint })[],
}

export interface FormattedArtifact extends Artifact {
  solidityVkey: SolidityVkey; 
}


/**
 * Formats vkey for solidity input
 *
 * @param vkey - verification key to format
 * @returns formatted vkey
 */
function formatVKey(vkey: VKey): SolidityVkey {
  // Parse points to X,Y coordinate bigints and return
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
    ic: vkey.IC.map((icEl) => ({
      x: BigInt(icEl[0]),
      y: BigInt(icEl[1]),
    })),
  };
}

/**
 * Fetches artifact with formatted verification key
 *
 * @param nullifiers - nullifier count
 * @param commitments - commitment count
 * @returns keys
 */
function getKeys(nullifiers: number, commitments: number): FormattedArtifact {
  // Get artifact or undefined
  const artifact = artifacts[nullifiers]?.[commitments];

  // Throw if undefined
  if (!artifact) {
    throw new Error('Artifact not found');
  }

  // Get format solidity vkey
  const artifactFormatted: FormattedArtifact = {
    ...artifact,
    solidityVkey: formatVKey(artifact.vkey),
  };

  return artifactFormatted;
}

/**
 * Returns all artifacts available
 *
 * @returns nullifier -\> commitments -\> keys
 */
function allArtifacts(): (undefined | (undefined | FormattedArtifact)[])[] {
  // Map each existing artifact to 
  return artifacts.map((nullifierList) => nullifierList?.map((artifact): FormattedArtifact | undefined => {
    if (!artifact) {
      return undefined;
    }

    const artifactFormatted = {
      ...artifact,
      solidityVkey: formatVKey(artifact.vkey),
    };

    return artifactFormatted;
  }));
}

/**
 * Lists all artifacts available
 *
 * @returns artifact configs
 */
function availableArtifacts() {
  const artifactsList: { nullifiers: number, commitments: number }[] = [];
  
  artifacts.forEach((nullifierList, nullifiers) => nullifierList?.forEach((artifact, commitments)=> {
    if (artifact) {
      artifactsList.push({ nullifiers, commitments });
    }
  }));

  return artifactsList;
}

export {
  formatVKey,
  getKeys,
  allArtifacts,
  availableArtifacts,
};
