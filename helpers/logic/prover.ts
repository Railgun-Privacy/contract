import { groth16, wtns } from 'snarkjs';
import type { SnarkjsProof } from 'snarkjs';
import type { Artifact } from 'railgun-circuit-test-artifacts';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ============ CONFIGURATION ============
const USE_RAPIDSNARK = process.env.USE_RAPIDSNARK === 'true';
const DEBUG_TIMING = process.env.DEBUG_TIMING === 'true';
const RAPIDSNARK_PATH = process.env.RAPIDSNARK_PATH || '/usr/local/bin/rapidsnark';

// Cache directory for artifact files (avoid writing large files every time)
const ARTIFACT_CACHE_DIR = path.join(os.tmpdir(), 'rapidsnark-artifacts');

// Ensure cache directory exists
if (USE_RAPIDSNARK && !fs.existsSync(ARTIFACT_CACHE_DIR)) {
  fs.mkdirSync(ARTIFACT_CACHE_DIR, { recursive: true });
}

// Cache for artifact file paths (keyed by hash of artifact content)
const artifactCache = new Map<string, { wasmPath: string; zkeyPath: string }>();

/**
 * Get or create cached artifact files
 */
function getCachedArtifactPaths(artifact: Artifact): { wasmPath: string; zkeyPath: string } {
  // Use a simple hash based on file sizes (fast approximation)
  const cacheKey = `${artifact.wasm.length}_${artifact.zkey.length}`;

  if (artifactCache.has(cacheKey)) {
    const cached = artifactCache.get(cacheKey)!;
    // Verify files still exist
    if (fs.existsSync(cached.wasmPath) && fs.existsSync(cached.zkeyPath)) {
      return cached;
    }
  }

  // Write to cache
  const wasmPath = path.join(ARTIFACT_CACHE_DIR, `${cacheKey}.wasm`);
  const zkeyPath = path.join(ARTIFACT_CACHE_DIR, `${cacheKey}.zkey`);

  if (!fs.existsSync(wasmPath)) {
    fs.writeFileSync(wasmPath, artifact.wasm);
  }
  if (!fs.existsSync(zkeyPath)) {
    fs.writeFileSync(zkeyPath, artifact.zkey);
  }

  artifactCache.set(cacheKey, { wasmPath, zkeyPath });
  return { wasmPath, zkeyPath };
}

export interface SolidityProof {
  a: {
    x: bigint;
    y: bigint;
  };
  b: {
    x: [bigint, bigint];
    y: [bigint, bigint];
  };
  c: {
    x: bigint;
    y: bigint;
  };
}

export interface ProofBundle {
  javascript: SnarkjsProof;
  solidity: SolidityProof;
}

/**
 * Formats javascript proof to solidity proof
 *
 * @param proof - javascript proof
 * @returns solidity proof
 */
function formatProof(proof: SnarkjsProof): SolidityProof {
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
 * Generate proof using rapidsnark (C++ prover, ~10x faster)
 *
 * @param artifact - circuit artifact
 * @param inputs - circuit inputs
 * @returns proof
 */
async function proveWithRapidsnark(artifact: Artifact, inputs: unknown): Promise<ProofBundle> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidsnark-'));

  try {
    // Get cached artifact paths (avoids writing large files every time)
    const { wasmPath, zkeyPath } = getCachedArtifactPaths(artifact);

    // Define temp file paths for this run
    const witnessPath = path.join(tmpDir, 'witness.wtns');
    const proofPath = path.join(tmpDir, 'proof.json');
    const publicPath = path.join(tmpDir, 'public.json');

    // Step 1: Generate witness using snarkjs (JS)
    const wtnsStart = Date.now();
    await wtns.calculate(inputs, wasmPath, witnessPath);
    const wtnsTime = Date.now() - wtnsStart;

    // Step 2: Generate proof using rapidsnark (C++)
    const proverStart = Date.now();
    execSync(`"${RAPIDSNARK_PATH}" "${zkeyPath}" "${witnessPath}" "${proofPath}" "${publicPath}"`, {
      stdio: 'pipe',
    });
    const proverTime = Date.now() - proverStart;

    if (DEBUG_TIMING) {
      console.log(`   ⏱️  prove: witness=${wtnsTime}ms, rapidsnark=${proverTime}ms`);
    }

    // Read and parse proof
    const proofJson = JSON.parse(fs.readFileSync(proofPath, 'utf-8'));

    const proof: SnarkjsProof = {
      pi_a: proofJson.pi_a,
      pi_b: proofJson.pi_b,
      pi_c: proofJson.pi_c,
      protocol: proofJson.protocol || 'groth16',
      curve: proofJson.curve || 'bn128',
    };

    return {
      javascript: proof,
      solidity: formatProof(proof),
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Generate proof using snarkjs (pure JavaScript)
 *
 * @param artifact - circuit artifact
 * @param inputs - circuit inputs
 * @returns proof
 */
async function proveWithSnarkjs(artifact: Artifact, inputs: unknown): Promise<ProofBundle> {
  const { proof } = await groth16.fullProve(inputs, artifact.wasm, artifact.zkey);
  return {
    javascript: proof,
    solidity: formatProof(proof),
  };
}

/**
 * Generate proof for a circuit
 * Uses rapidsnark (C++) if USE_RAPIDSNARK=true, otherwise snarkjs (JS)
 *
 * @param artifact - circuit artifact
 * @param inputs - circuit inputs
 * @returns proof
 */
async function prove(artifact: Artifact, inputs: unknown): Promise<ProofBundle> {
  if (USE_RAPIDSNARK) {
    return proveWithRapidsnark(artifact, inputs);
  }
  return proveWithSnarkjs(artifact, inputs);
}

export { formatProof, prove };
