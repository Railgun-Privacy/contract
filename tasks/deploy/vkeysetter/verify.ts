import { task } from 'hardhat/config';
import { expect } from 'chai';

import artifacts from './artifacts.json';

task(
  'deploy:VKeySetter:verify',
  'Verifies artifacts were loaded into VKeySetter or Verifier contract',
)
  .addParam('verifier', 'Address of Verifier contract')
  .setAction(async function (
    {
      verifier,
    }: {
      verifier: string;
    },
    hre,
  ) {
    const { ethers } = hre;

    // Get contract interface
    const verifierContract = await ethers.getContractAt('Verifier', verifier);

    // Check artifacts exist
    for (const artifact of artifacts) {
      console.log(`Verifying ${artifact.nullifiers}x${artifact.commitments}`);
      const key = await verifierContract.getVerificationKey(
        artifact.nullifiers,
        artifact.commitments,
      );
      expect(key.artifactsIPFSHash).to.equal(artifact.contractVKey.artifactsIPFSHash);
      expect(key.alpha1.x).to.equal(artifact.contractVKey.alpha1.x);
      expect(key.beta2.x[0]).to.equal(artifact.contractVKey.beta2.x[0]);
      expect(key.ic.length).to.equal(artifact.contractVKey.ic.length);
    }
  });
