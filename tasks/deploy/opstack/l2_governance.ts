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

task('deploy:opstack:l2_governance', 'Creates L2 governance deployment for opstack')
  .addParam('senderL1', 'Address of the sender contract on L1')
  .addParam('delegator', 'Address of the delegator contract on L2')
  .addParam('messenger', 'Address of the OP stack messenger contract on L2')
  .setAction(async function (
    { senderL1, delegator, messenger }: { senderL1: string; delegator: string; messenger: string },
    hre,
  ) {
    const { ethers } = hre;
    await hre.run('compile');

    // Get build artifacts
    const Executor = await ethers.getContractFactory('OPStackExecutor');

    // Deploy executor
    const executor = await Executor.deploy(senderL1, delegator, messenger);
    await logVerify('Executor', executor, [senderL1, delegator, messenger]);
  });
