import { task, types } from 'hardhat/config';

import { diffVkeys } from './shared';
import { allArtifacts } from '../../../helpers/logic/artifacts';

task(
  'deploy:VKeySetter:verify',
  'Verifies artifacts were loaded into VKeySetter or Verifier contract',
)
  .addParam('verifier', 'Address of Verifier contract')
  .addParam('limit', 'Largest nullifier and commitment count to check diff for', 99, types.int)
  .setAction(async function (
    {
      verifier,
      limit,
    }: {
      verifier: string;
      limit: number;
    },
    hre,
  ) {
    const { ethers } = hre;

    // Get artifacts
    const artifacts = allArtifacts();

    // Get contract interface
    const verifierContract = await ethers.getContractAt('Verifier', verifier);

    // Get diff
    const diff = await diffVkeys(artifacts, verifierContract, limit, true);

    console.log(JSON.stringify(diff, undefined, 2));
    console.log(
      diff.length == 0
        ? 'No diff found, verification successful'
        : `${diff.length} differences found`,
    );
  });
