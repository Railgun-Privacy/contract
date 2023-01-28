import { task } from 'hardhat/config';
import { setBalance, setCode, time } from '@nomicfoundation/hardhat-network-helpers';
import { getStorageAt, setStorageAt } from '@nomicfoundation/hardhat-network-helpers';

task('accounts', 'Prints the list of accounts', async (taskArguments, hre) => {
  const accounts = await hre.ethers.getSigners();
  accounts.forEach((account) => {
    console.log(account.address);
  });
});

task('set-token-balance', 'Sets balance of ERC20 token')
  .addParam('address', 'Address to set balance for')
  .addParam('token', 'Token address to set balance on')
  .addParam('balance', 'Balance to set')
  .setAction(
    async (
      { address, token, balance }: { address: string; token: string; balance: string },
      hre,
    ) => {
      // Format balance
      const balanceFormatted = `0x${BigInt(balance).toString(16).padStart(64, '0')}`;

      // Get token
      const ERC20 = await hre.ethers.getContractFactory('TestERC20');
      const erc20 = ERC20.attach(token);

      for (let i = 0; i < 1000; i += 1) {
        // Calculate storage slot
        const storageSlot = hre.ethers.utils.solidityKeccak256(
          ['uint256', 'uint256'],
          [address, i],
        );

        // Get storage before
        const before = await getStorageAt(token, storageSlot);

        // Set storage
        await setStorageAt(token, storageSlot, balanceFormatted);

        // Check if token balance changed
        if ((await erc20.balanceOf(address)).toBigInt() === BigInt(balance)) break;

        // Restore storage before going to next slot
        await setStorageAt(token, storageSlot, before);
      }
    },
  );

task('set-eth-balance', 'Sets ETH balance')
  .addParam('address', 'Address to set balance for')
  .addParam('balance', 'Balance to set')
  .setAction(async ({ address, balance }: { address: string; balance: string }, hre) => {
    await setBalance(address, hre.ethers.BigNumber.from(balance).toHexString());
  });

task('set-code', 'Sets contract code for address')
  .addParam('address', 'Address to set code for')
  .addParam('contract', 'Contract to set at address')
  .setAction(async ({ address, contract }: { address: string; contract: string }, hre) => {
    const code = await hre.artifacts.readArtifact(contract);
    await setCode(address, code.deployedBytecode);
  });

task('fastforward', 'Fast forwards time')
  .addParam('days', 'Days to fast forward (accepts decimal values)')
  .setAction(async (taskArguments: { days: string }) => {
    await time.increase(86400 * Number(taskArguments.days));
    console.log(`Fast forwarded ${taskArguments.days} days`);
  });

task(
  'load-debug-info',
  'Loads debug info into hardhat node for better errors in fork mode',
).setAction(async (taskArguments, hre) => {
  const list = await hre.artifacts.getAllFullyQualifiedNames();
  for (const fqn of list) {
    console.log(`Loading debug artifacts for ${fqn}`);
    const buildInfo = await hre.artifacts.getBuildInfo(fqn);
    await hre.ethers.provider.send('hardhat_addCompilationResult', [
      buildInfo?.solcVersion,
      buildInfo?.input,
      buildInfo?.output,
    ]);
  }
});
