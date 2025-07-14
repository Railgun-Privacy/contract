import {
  FormattedArtifact,
  matchG1Point,
  matchG2Point,
  SolidityVKey,
} from '../../../helpers/logic/artifacts';
import { VerifyingKeyStructOutput } from '../../../typechain-types/contracts/logic/Verifier';

export type LocalArtifactSource = (undefined | (undefined | FormattedArtifact)[])[];
export interface ChainArtifactSource {
  getVerificationKey: (
    nullifiers: number,
    commitments: number,
  ) => Promise<VerifyingKeyStructOutput>;
}

/**
 * Gets verification key from vkey source
 *
 * @param source - source to fetch from
 * @param nullifiers - nullifier count
 * @param commitments - commitment count
 * @returns vkey
 */
async function getVerificationKeyFromSource(
  source: ChainArtifactSource | LocalArtifactSource,
  nullifiers: number,
  commitments: number,
): Promise<SolidityVKey> {
  // If source is chain, call getter function and format
  if (!Array.isArray(source)) {
    // Get verifier output
    const output = await source.getVerificationKey(nullifiers, commitments);

    // Format verifier output
    return {
      artifactsIPFSHash: output.artifactsIPFSHash,
      alpha1: {
        x: output.alpha1.x.toBigInt(),
        y: output.alpha1.y.toBigInt(),
      },
      beta2: {
        x: [output.beta2.x[0].toBigInt(), output.beta2.x[1].toBigInt()],
        y: [output.beta2.y[0].toBigInt(), output.beta2.y[1].toBigInt()],
      },
      gamma2: {
        x: [output.gamma2.x[0].toBigInt(), output.gamma2.x[1].toBigInt()],
        y: [output.gamma2.y[0].toBigInt(), output.gamma2.y[1].toBigInt()],
      },
      delta2: {
        x: [output.delta2.x[0].toBigInt(), output.delta2.x[1].toBigInt()],
        y: [output.delta2.y[0].toBigInt(), output.delta2.y[1].toBigInt()],
      },
      ic: output.ic.map((point) => ({
        x: point.x.toBigInt(),
        y: point.y.toBigInt(),
      })),
    };
  }

  // If source is LocalArtifactSource, fetch and return with default
  return (
    source[nullifiers]?.[commitments]?.solidityVKey ?? {
      artifactsIPFSHash: '',
      alpha1: {
        x: 0n,
        y: 0n,
      },
      beta2: {
        x: [0n, 0n],
        y: [0n, 0n],
      },
      gamma2: {
        x: [0n, 0n],
        y: [0n, 0n],
      },
      delta2: {
        x: [0n, 0n],
        y: [0n, 0n],
      },
      ic: [],
    }
  );
}

/**
 * Compares two vkey sources and finds differences
 *
 * @param left - left side vkey source
 * @param right - right side vkey source
 * @param limit - arbitrary limit for nullifier/commitment counts
 * @param print - print progress
 * @returns differences
 */
async function diffVkeys(
  left: ChainArtifactSource | LocalArtifactSource,
  right: ChainArtifactSource | LocalArtifactSource,
  limit = 100,
  print = false,
) {
  const differences: { nullifiers: number; commitments: number }[] = [];

  for (let nullifiers = 0; nullifiers <= limit; nullifiers += 1) {
    for (let commitments = 0; commitments <= limit; commitments += 1) {
      if (print)
        console.log(
          `Comparing ${nullifiers.toString().padStart(2, '0')}x${commitments
            .toString()
            .padStart(2, '0')}`,
        );

      // Fetch left and right
      const leftVkey = await getVerificationKeyFromSource(left, nullifiers, commitments);
      const rightVKey = await getVerificationKeyFromSource(right, nullifiers, commitments);

      // Compare left and right
      if (leftVkey.artifactsIPFSHash !== rightVKey.artifactsIPFSHash) {
        differences.push({ nullifiers, commitments });
        continue;
      }

      if (!matchG1Point(leftVkey.alpha1, rightVKey.alpha1)) {
        differences.push({ nullifiers, commitments });
        continue;
      }
      if (!matchG2Point(leftVkey.beta2, rightVKey.beta2)) {
        differences.push({ nullifiers, commitments });
        continue;
      }
      if (!matchG2Point(leftVkey.gamma2, rightVKey.gamma2)) {
        differences.push({ nullifiers, commitments });
        continue;
      }
      if (!matchG2Point(leftVkey.delta2, rightVKey.delta2)) {
        differences.push({ nullifiers, commitments });
        continue;
      }

      if (leftVkey.ic.length !== rightVKey.ic.length) {
        differences.push({ nullifiers, commitments });
        continue;
      }
      if (
        !leftVkey.ic
          .map((point, index) => matchG1Point(point, rightVKey.ic[index]))
          .reduce((a, b) => a || b, true)
      ) {
        differences.push({ nullifiers, commitments });
        continue;
      }
    }
  }

  return differences;
}

export { diffVkeys };
