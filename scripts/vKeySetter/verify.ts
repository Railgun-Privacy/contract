import { ethers } from 'hardhat';
import { expect } from 'chai';

import artifacts from './artifacts.json';

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const verifier = await ethers.getContractAt('Verifier', process.env.VERIFIER!);

  for (const artifact of artifacts) {
    const key = await verifier.getVerificationKey(artifact.nullifiers, artifact.commitments);
    expect(key.artifactsIPFSHash).to.equal(artifact.contractVKey.artifactsIPFSHash);
    expect(key.alpha1.x).to.equal(artifact.contractVKey.alpha1.x);
    expect(key.beta2.x[0]).to.equal(artifact.contractVKey.beta2.x[0]);
    expect(key.ic.length).to.equal(artifact.contractVKey.ic.length);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
