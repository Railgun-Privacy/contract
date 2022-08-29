import { HardhatUserConfig, task } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import 'hardhat-local-networks-config-plugin';
import { time } from '@nomicfoundation/hardhat-network-helpers';

import type { HardhatRuntimeEnvironment } from 'hardhat/types';

import { poseidonContract } from 'circomlibjs';
import mocharc from './.mocharc.json';

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  solidity: {
    version: '0.8.12',
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

async function overwriteArtifact(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  bytecode: string,
) {
  const artifact = await hre.artifacts.readArtifact(contractName);
  await hre.artifacts.saveArtifactAndDebugFile({
    ...artifact,
    bytecode,
  });
}

task(
  'compile',
  'Compiles the entire project, building all artifacts and injecting precompiled artifacts',
  async (taskArguments, hre, runSuper) => {
    await runSuper();
    await overwriteArtifact(hre, 'PoseidonT3', poseidonContract.createCode(2));
    await overwriteArtifact(hre, 'PoseidonT4', poseidonContract.createCode(3));
  },
);

task('test', 'Runs test suite')
  .addOptionalParam('longtests', 'extra = longer tests enabled; complete = full test suite enabled')
  .setAction(async (taskArguments, hre, runSuper) => {
    if (
      taskArguments.longtests === 'none' ||
      taskArguments.longtests === 'extra' ||
      taskArguments.longtests === 'complete'
    ) {
      process.env.LONG_TESTS = taskArguments.longtests;
    } else {
      process.env.LONG_TESTS = 'complete';
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
  await hre.run('run', { script: 'scripts/deploy_test.js' });
});

task(
  'forktoken',
  'Gives 100m balance to address[0] when running in fork mode',
  async (taskArguments, hre) => {
    await hre.run('run', { script: 'scripts/grant_balance.js' });
  },
);

task('fastforward', 'Fast forwards time')
  .addParam('days', 'Days to fast forward (accepts decimal values)')
  .setAction(async (taskArguments) => {
    await time.increase(86400 * taskArguments.days);
    console.log(`Fast forwarded ${taskArguments.days} days`);
  });

export default config;
