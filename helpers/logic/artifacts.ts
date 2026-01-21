import artifacts from 'railgun-circuit-test-artifacts';
import { getIPFSHash } from './artifactsIPFSHashes';
import type { Artifact, ArtifactConfig, VKey } from 'railgun-circuit-test-artifacts';
import { Verifier } from '../../typechain-types';
import * as fs from 'fs';
import * as path from 'path';

// ============ LOCAL CIRCUIT CONFIGURATION ============
const USE_LOCAL_CIRCUITS = process.env.USE_LOCAL_CIRCUITS === 'true';
const LOCAL_CIRCUITS_PATH = process.env.LOCAL_CIRCUITS_PATH || path.join(__dirname, '../../../circuits-v2');

// Local circuit configs (same as circuitConfigs.js in circuits-v2)
const localCircuitConfigs: ArtifactConfig[] = [];
for (let nullifiers = 1; nullifiers <= 14; nullifiers += 1) {
  for (let commitments = 1; commitments <= 14 - nullifiers; commitments += 1) {
    localCircuitConfigs.push({ nullifiers, commitments });
  }
}

/**
 * Get circuit name from nullifiers and commitments count
 */
function circuitConfigToName(nullifiers: number, commitments: number): string {
  return `${nullifiers.toString().padStart(2, '0')}x${commitments.toString().padStart(2, '0')}`;
}

/**
 * Load artifact from local compiled circuits
 */
function getLocalArtifact(nullifiers: number, commitments: number): Artifact {
  const name = circuitConfigToName(nullifiers, commitments);
  const buildDir = path.join(LOCAL_CIRCUITS_PATH, 'build');
  const zkeyDir = path.join(LOCAL_CIRCUITS_PATH, 'zkeys');

  const wasmPath = path.join(buildDir, `${name}_js/${name}.wasm`);
  const zkeyPath = path.join(zkeyDir, `${name}.zkey`);
  const vkeyPath = path.join(zkeyDir, `${name}.vkey.json`);

  // Check files exist
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Local circuit WASM not found: ${wasmPath}\nRun: cd circuits-v2 && npm run build`);
  }
  if (!fs.existsSync(zkeyPath)) {
    throw new Error(`Local circuit zkey not found: ${zkeyPath}\nRun: cd circuits-v2 && npm run ceremony`);
  }
  if (!fs.existsSync(vkeyPath)) {
    throw new Error(`Local circuit vkey not found: ${vkeyPath}\nRun the vkey export step`);
  }

  return {
    wasm: fs.readFileSync(wasmPath),
    zkey: fs.readFileSync(zkeyPath),
    vkey: JSON.parse(fs.readFileSync(vkeyPath, 'utf-8')) as VKey,
  };
}

/**
 * Get artifact - uses local or IPFS based on USE_LOCAL_CIRCUITS env var
 */
function getArtifact(nullifiers: number, commitments: number): Artifact {
  if (USE_LOCAL_CIRCUITS) {
    console.log(`📁 Circuit Source LOCAL, Loading circuit ${circuitConfigToName(nullifiers, commitments)}`);
    return getLocalArtifact(nullifiers, commitments);
  }
  console.log(`🌐 Circuit Source: IPFS (node_modules), Loading circuit ${circuitConfigToName(nullifiers, commitments)}`);
  return artifacts.getArtifact(nullifiers, commitments);
}

/**
 * List available artifacts
 */
function getListArtifacts(): ArtifactConfig[] {
  if (USE_LOCAL_CIRCUITS) {
    return localCircuitConfigs;
  }
  return artifacts.listArtifacts();
}

export interface SolidityG1Point {
  x: bigint;
  y: bigint;
}

export interface SolidityG2Point {
  x: [bigint, bigint];
  y: [bigint, bigint];
}

export interface SolidityVKey {
  artifactsIPFSHash: string;
  alpha1: {
    x: bigint;
    y: bigint;
  };
  beta2: {
    x: [bigint, bigint];
    y: [bigint, bigint];
  };
  gamma2: {
    x: [bigint, bigint];
    y: [bigint, bigint];
  };
  delta2: {
    y: [bigint, bigint];
    x: [bigint, bigint];
  };
  ic: { x: bigint; y: bigint }[];
}

export type EventVKeyMatcher = (i: unknown) => boolean;

export interface FormattedArtifact extends Artifact {
  solidityVKey: SolidityVKey;
  eventVKeyMatcher: EventVKeyMatcher;
}

const testingSubsetArtifactsConfigs = [
  {
    nullifiers: 1,
    commitments: 2,
  },
  {
    nullifiers: 2,
    commitments: 3,
  },
  {
    nullifiers: 8,
    commitments: 4,
  },
  {
    nullifiers: 12,
    commitments: 2,
  },
];

/**
 * Formats vkey for solidity input
 *
 * @param vkey - verification key to format
 * @param artifactsIPFSHash - IPFS hash of circuit artifact
 * @returns formatted vkey
 */
function formatVKey(vkey: VKey, artifactsIPFSHash: string): SolidityVKey {
  // Parse points to X,Y coordinate bigints and return
  return {
    artifactsIPFSHash,
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
 * Check G1 points match
 *
 * @param point1 - point 1
 * @param point2 - point 2
 * @returns points match
 */
function matchG1Point(point1: Record<string, unknown>, point2: SolidityG1Point) {
  // Check coordinates match, not strict equals so that similar number types can be matched
  if (point1.x != point2.x) return false;
  if (point1.y != point2.y) return false;

  return true;
}

/**
 * Check G1 points match
 *
 * @param point1 - point 1
 * @param point2 - point 2
 * @returns points match
 */
function matchG2Point(point1: Record<string, unknown>, point2: SolidityG2Point) {
  // Check coordinate arrays exist
  if (!Array.isArray(point1.x)) return false;
  if (!Array.isArray(point1.y)) return false;

  // Check coordinates match, not strict equals so that similar number types can be matched
  if (point1.x[0] != point2.x[0]) return false;
  if (point1.x[1] != point2.x[1]) return false;
  if (point1.y[0] != point2.y[0]) return false;
  if (point1.y[1] != point2.y[1]) return false;

  return true;
}

/**
 * Formats vkey for solidity event checking
 *
 * @param vkey - verification key to format
 * @param artifactsIPFSHash - IPFS hash of circuit artifact
 * @returns formatted vkey
 */
function formatVKeyMatcher(vkey: VKey, artifactsIPFSHash: string): EventVKeyMatcher {
  const vkeySolidity = formatVKey(vkey, artifactsIPFSHash);

  return (i: unknown): boolean => {
    // Check type
    if (!i) return false;
    if (typeof i !== 'object') return false;

    // Cast to record
    const iCast = i as Record<string, unknown>;

    // Check artifactsIPFSHash
    if (iCast.artifactsIPFSHash !== vkeySolidity.artifactsIPFSHash) return false;

    // Check alpha point
    if (!iCast.alpha1) return false;
    if (typeof iCast.alpha1 !== 'object') return false;
    if (!matchG1Point(iCast.alpha1 as Record<string, unknown>, vkeySolidity.alpha1)) return false;

    // Check beta point
    if (!iCast.beta2) return false;
    if (typeof iCast.beta2 !== 'object') return false;
    if (!matchG2Point(iCast.beta2 as Record<string, unknown>, vkeySolidity.beta2)) return false;

    // Check beta point
    if (!iCast.gamma2) return false;
    if (typeof iCast.gamma2 !== 'object') return false;
    if (!matchG2Point(iCast.gamma2 as Record<string, unknown>, vkeySolidity.gamma2)) return false;

    // Check beta point
    if (!iCast.delta2) return false;
    if (typeof iCast.delta2 !== 'object') return false;
    if (!matchG2Point(iCast.delta2 as Record<string, unknown>, vkeySolidity.delta2)) return false;

    // Check IC
    if (!Array.isArray(iCast.ic)) return false;
    if (iCast.ic.length !== vkeySolidity.ic.length) return false;
    for (let index = 0; index < iCast.ic.length; index += 1) {
      if (!matchG1Point(iCast.ic[index] as Record<string, unknown>, vkeySolidity.ic[index]))
        return false;
    }

    return true;
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
  // Get artifact (local or IPFS based on USE_LOCAL_CIRCUITS)
  const artifact = getArtifact(nullifiers, commitments);

  // Get artifact IPFS hash (use placeholder for local circuits)
  const artifactIPFSHash = USE_LOCAL_CIRCUITS
    ? `local:${circuitConfigToName(nullifiers, commitments)}`
    : getIPFSHash(nullifiers, commitments);

  // Get format solidity vkey
  const artifactFormatted: FormattedArtifact = {
    ...artifact,
    solidityVKey: formatVKey(artifact.vkey, artifactIPFSHash),
    eventVKeyMatcher: formatVKeyMatcher(artifact.vkey, artifactIPFSHash),
  };

  return artifactFormatted;
}

/**
 * Returns all artifacts available
 *
 * @returns nullifier -\> commitments -\> keys
 */
function allArtifacts(): (undefined | (undefined | FormattedArtifact)[])[] {
  // Map each existing artifact to formatted artifact
  const circuitArtifacts: (undefined | (undefined | FormattedArtifact)[])[] = [];

  artifacts.listArtifacts().forEach((circuit) => {
    if (!circuitArtifacts[circuit.nullifiers]) circuitArtifacts[circuit.nullifiers] = [];

    // @ts-expect-error will always be set above
    circuitArtifacts[circuit.nullifiers][circuit.commitments] = getKeys(
      circuit.nullifiers,
      circuit.commitments,
    );
  });

  return circuitArtifacts;
}

/**
 * Returns testing subset artifacts
 *
 * @returns nullifier -\> commitments -\> keys
 */
function testingSubsetArtifacts(): (undefined | (undefined | FormattedArtifact)[])[] {
  // Map each existing artifact to formatted artifact
  const circuitArtifacts: (undefined | (undefined | FormattedArtifact)[])[] = [];

  testingSubsetArtifactsConfigs.forEach((circuit) => {
    if (!circuitArtifacts[circuit.nullifiers]) circuitArtifacts[circuit.nullifiers] = [];

    // @ts-expect-error will always be set above
    circuitArtifacts[circuit.nullifiers][circuit.commitments] = getKeys(
      circuit.nullifiers,
      circuit.commitments,
    );
  });

  return circuitArtifacts;
}

/**
 * Loads artifact list into verifier contract
 *
 * @param verifierContract - verifier contract
 * @param artifactList - artifact list to load into contract
 * @returns complete
 */
async function loadArtifacts(verifierContract: Verifier, artifactList: ArtifactConfig[]) {
  for (const artifactConfig of artifactList) {
    const artifact = getKeys(artifactConfig.nullifiers, artifactConfig.commitments);
    await (
      await verifierContract.setVerificationKey(
        artifactConfig.nullifiers,
        artifactConfig.commitments,
        artifact.solidityVKey,
      )
    ).wait();
  }
}

const listArtifacts = getListArtifacts;

/**
 * List only testing subset of artifacts
 *
 * @returns artifacts list
 */
function listTestingSubsetArtifacts() {
  return testingSubsetArtifactsConfigs;
}

export {
  matchG1Point,
  matchG2Point,
  formatVKey,
  formatVKeyMatcher,
  getKeys,
  allArtifacts,
  testingSubsetArtifacts,
  listArtifacts,
  listTestingSubsetArtifacts,
  loadArtifacts,
};
