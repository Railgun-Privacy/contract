import type {HardhatUserConfig} from 'hardhat/config';
import type {HardhatRuntimeEnvironment} from 'hardhat/types/runtime';
import type {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import ethers from '@nomiclabs/hardhat-ethers';
import {task} from 'hardhat/config';
import '@nomiclabs/hardhat-etherscan';
import '@nomiclabs/hardhat-waffle';
import '@typechain/hardhat';
import 'hardhat-gas-reporter';
import 'solidity-coverage';
// @ts-ignore
import {poseidonContract} from 'circomlibjs';
import mocharc from './.mocharc.json';

let networks;

try {
  // eslint-disable-next-line
  networks = require('./networks.config');
} catch (e: any) {
  if (e.code !== 'MODULE_NOT_FOUND') {
    // Re-throw not "Module not found" errors
    throw e;
  }
  networks = {
    hardhat: {},
    localhost: {
      url: 'http://127.0.0.1:8545',
    },
  };
}

async function overwriteArtifact(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  bytecode: string
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
  }
);

task('test', 'Runs test suite')
  .addOptionalParam('longtests', 'extra = longer tests enabled; complete = full test suite enabled')
  .setAction(async (taskArguments, hre, runSuper) => {
    if (taskArguments.longtests === 'extra' || taskArguments.longtests === 'complete') {
      process.env.LONG_TESTS = taskArguments.longtests;
    }
    await runSuper();
  });

task('accounts', 'Prints the list of accounts', async () => {
  const accounts = await (ethers as any).getSigners();

  accounts.forEach((account: SignerWithAddress) => {
    console.log(account.address);
  });
});

task('deploy:test', 'Deploy full deployment for testing purposes', async (taskArguments, hre) => {
  await hre.run('run', {script: 'scripts/deploy_test.js'});
});

task(
  'forktoken',
  'Gives 100m balance to address[0] when running in fork mode',
  async (taskArguments, hre) => {
    await hre.run('run', {script: 'scripts/grant_balance.js'});
  }
);

task('fastforward', 'Fast forwards time')
  .addParam('days', 'Days to fast forward (accepts decimal values)')
  .setAction(async (taskArguments, hre) => {
    await hre.ethers.provider.send('evm_increaseTime', [Math.round(86400 * taskArguments.days)]);
    console.log(`Fast forwarded ${Math.round(86400 * taskArguments.days)} seconds`);
    await hre.ethers.provider.send('evm_mine', []);
  });

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  networks,
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
    enabled: process.env.REPORT_GAS !== undefined,
    currency: 'USD',
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};

export default config;
