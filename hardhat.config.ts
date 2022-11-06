import { HardhatUserConfig, task } from 'hardhat/config';
import '@nomicfoundation/hardhat-chai-matchers';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import '@typechain/hardhat';
import 'hardhat-gas-reporter';
import 'solidity-coverage';
import 'hardhat-local-networks-config-plugin';
import { time, setStorageAt, getStorageAt } from '@nomicfoundation/hardhat-network-helpers';
import { TASK_COMPILE, TASK_CLEAN, TASK_TEST } from 'hardhat/builtin-tasks/task-names';

import { poseidonContract } from 'circomlibjs';
import { overwriteArtifact, exportABIs, cleanExportedAbis } from './hardhat.utils';
import mocharc from './.mocharc.json';

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  solidity: {
    version: '0.8.17',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1600,
      },
      outputSelection: {
        '*': {
          '*': ['storageLayout'],
        },
      },
    },
  },
  mocha: mocharc,
  gasReporter: {
    enabled: true,
    currency: 'USD',
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};

const exportContractABIs = [
  // Logic
  'contracts/logic/RailgunSmartWallet.sol:RailgunSmartWallet',
  'contracts/adapt/Relay.sol:RelayAdapt',
  // Governance
  'contracts/governance/Staking.sol:Staking',
  'contracts/governance/Voting.sol:Voting',
];

task(TASK_COMPILE).setAction(async (taskArguments, hre, runSuper) => {
  await runSuper();
  await overwriteArtifact(
    hre,
    'contracts/logic/Poseidon.sol:PoseidonT3',
    poseidonContract.createCode(2),
  );
  await overwriteArtifact(
    hre,
    'contracts/logic/Poseidon.sol:PoseidonT4',
    poseidonContract.createCode(3),
  );
  await hre.run('abi-export');
});

task(TASK_CLEAN).setAction(async (taskArguments, hre, runSuper) => {
  await runSuper();
  await hre.run('abi-clean');
});

task('abi-clean', 'Clean exported ABI artifacts').setAction((taskArguments, hre) => {
  return new Promise((resolve) => {
    cleanExportedAbis(hre);
    resolve(null);
  });
});

task('abi-export', 'Export ABI artifacts').setAction(async (taskArguments, hre) => {
  await exportABIs(hre, exportContractABIs);
});

task(TASK_TEST, 'Runs test suite')
  .addOptionalParam(
    'longtests',
    'no = execute shorter tests; no = full test suite enabled (default: yes)',
  )
  .setAction(async (taskArguments: { longtests: string }, hre, runSuper) => {
    if (taskArguments.longtests === 'no' || taskArguments.longtests === 'yes') {
      process.env.LONG_TESTS = taskArguments.longtests;
    } else if (process.env.LONG_TESTS !== 'no') {
      process.env.LONG_TESTS = 'yes';
    }
    await runSuper();
  });

task('accounts', 'Prints the list of accounts', async (taskArguments, hre) => {
  const accounts = await hre.ethers.getSigners();
  accounts.forEach((account) => {
    console.log(account.address);
  });
});

task('deploy:test', 'Deploy full deployment for testing purposes', async (taskArguments, hre) => {
  await hre.run('run', { script: 'scripts/deploy_test.ts' });
});

task('set-balance', 'Sets balance of ERC20 token')
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
          [(await hre.ethers.getSigners())[0].address, i],
        );

        // Get storage before
        const before = await getStorageAt(token, storageSlot);

        // Set storage
        await setStorageAt(token, storageSlot, balanceFormatted);

        // Check if token balance changed
        if ((await erc20.balanceOf(address)).toBigInt() === BigInt(balanceFormatted)) break;

        // Restore storage before going to next slot
        await setStorageAt(token, storageSlot, before);
      }
    },
  );

task('fastforward', 'Fast forwards time')
  .addParam('days', 'Days to fast forward (accepts decimal values)')
  .setAction(async (taskArguments: { days: string }) => {
    await time.increase(86400 * Number(taskArguments.days));
    console.log(`Fast forwarded ${taskArguments.days} days`);
  });

export default config;
