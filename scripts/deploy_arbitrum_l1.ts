import { ethers } from 'hardhat';
import { Contract } from 'ethers';

// Arbitrum Inbox Address
// Ethereum: 0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f
// Goerli: 0x6BEbC4925716945D46F0Ec336D5C2564F419682C
const INBOX = '0x6BEbC4925716945D46F0Ec336D5C2564F419682C';

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

async function main() {
  // Get build artifacts
  const Sender = await ethers.getContractFactory('ArbitrumSender');

  // Deploy voting
  const sender = await Sender.deploy(
    (
      await ethers.getSigners()
    )[0].address,
    ethers.constants.AddressZero,
    INBOX,
  );
  await logVerify('Sender', sender, [
    (await ethers.getSigners())[0].address,
    ethers.constants.AddressZero,
    INBOX,
  ]);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
