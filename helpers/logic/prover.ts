import {Artifact, CircuitInputs, Proof, SolidityProof} from '../types/types';
import {groth16} from 'snarkjs';

/**
 * Formats javascript proof to solidity proof
 *
 * @param proof - javascript proof
 * @returns solidity proof
 */
export const formatProof = (proof: Proof): SolidityProof => {
  return {
    a: {x: BigInt(proof.pi_a[0]), y: BigInt(proof.pi_a[1])},
    b: {
      x: [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      y: [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    },
    c: {x: BigInt(proof.pi_c[0]), y: BigInt(proof.pi_c[1])},
  };
};

/**
 * Generate proof for a circuit
 *
 * @param artifact - circuit artifact
 * @param inputs - circuit inputs
 * @returns proof
 */
export const prove = async (artifact: Artifact, inputs: CircuitInputs): Promise<Proof> => {
  const {proof} = await groth16.fullProve(inputs, artifact.wasm, artifact.zkey);
  return {
    javascript: proof,
    solidity: formatProof(proof),
  };
};
