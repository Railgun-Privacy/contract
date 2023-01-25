import { task } from 'hardhat/config';
import type { TaskArguments } from 'hardhat/types';

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

task('deploy:arbitrum:l1_governance', 'Creates L1 governance deployment for arbitrum')
  .addParam('inbox', 'Address of arbitrum delayed inbox contract')
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers } = hre;
    await hre.run('compile');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const INBOX = taskArguments.inbox as string;

    // Get build artifacts
    const Sender = await ethers.getContractFactory('ArbitrumSender');

    // Deploy voting
    const sender = await Sender.deploy(
      (
        await ethers.getSigners()
      )[0].address,
      '0x0000000000000000000000000000000000000001',
      INBOX,
    );
    await logVerify('Sender', sender, [
      (await ethers.getSigners())[0].address,
      '0x0000000000000000000000000000000000000001',
      INBOX,
    ]);

    console.log(
      'After deployment of L2 governance call setExecutorL2(address) with the address for the L2 executor then transferOwnership(address) with the address of L1 delegator',
    );
  });
