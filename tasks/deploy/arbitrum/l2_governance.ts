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

task('deploy:arbitrum:l2_governance', 'Creates L2 governance deployment for arbitrum')
  .addParam('senderL1', 'Address of the sender contract on L1')
  .addParam('delegator', 'Address of the delegator contract on L2')
  .setAction(async function (
    { senderL1, delegator }: { senderL1: string; delegator: string },
    hre,
  ) {
    const { ethers } = hre;
    await hre.run('compile');

    // Get build artifacts
    const Executor = await ethers.getContractFactory('ArbitrumExecutor');

    // Deploy executor
    const executor = await Executor.deploy(senderL1, delegator);
    await logVerify('Executor', executor, [senderL1, delegator]);
  });
