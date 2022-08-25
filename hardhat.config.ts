import { HardhatUserConfig, task } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import 'hardhat-local-networks-config-plugin';

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
    enabled: process.env.REPORT_GAS !== undefined,
    currency: 'USD',
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};

async function overwriteArtifact(hre: HardhatRuntimeEnvironment, contractName: string, bytecode: string) {
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

export default config;
