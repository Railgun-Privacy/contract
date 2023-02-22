import { task } from 'hardhat/config';

import type { Contract } from 'ethers';

/**
 * Log data to verify contract
 *
 * @param name - name of contract
 * @param contract - contract object
 * @param constructorArguments - constructor arguments
 * @returns promise resolved on deploy deployed
 */
async function logVerify(
  name: string,
  contract: Contract,
  constructorArguments: unknown[],
): Promise<null> {
  console.log(`\nDeploying ${name}`);
  console.log({
    address: contract.address,
    constructorArguments,
  });
  return contract.deployTransaction.wait().then();
}

task('deploy:VKeySetter:deploy', 'Creates VKeySetter contract')
  .addParam('delegator', 'Address of governance delegator contract')
  .addParam('verifier', 'Address of verifier/inherited contract')
  .setAction(async function (
    { delegator, verifier }: { delegator: string; verifier: string },
    hre,
  ) {
    const { ethers } = hre;
    await hre.run('compile');

    // Get build artifacts
    const VKeySetter = await ethers.getContractFactory('VKeySetter');

    // Deploy vKeySetter
    const vkeySetter = await VKeySetter.deploy(
      (
        await ethers.getSigners()
      )[0].address,
      delegator,
      verifier,
    );

    await logVerify('VKeySetter', vkeySetter, [
      (await ethers.getSigners())[0].address,
      delegator,
      verifier,
    ]);
  });
