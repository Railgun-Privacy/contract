/* global task hre */
const ethers = require('@nomiclabs/hardhat-ethers');
require('@nomiclabs/hardhat-etherscan');
require('@nomiclabs/hardhat-waffle');
require('hardhat-gas-reporter');
require('hardhat-artifactor');
require('hardhat-tracer');
require('hardhat-docgen');

let networks;

try {
  // eslint-disable-next-line
  networks = require('./networks.config');
} catch (e) {
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

task('accounts', 'Prints the list of accounts', async () => {
  const accounts = await ethers.getSigners();

  accounts.forEach((account) => {
    // eslint-disable-next-line no-console
    console.log(account.address);
  });
});

task('deploy:new', 'Deploy fresh instance', async () => {
  await hre.run('run', { script: 'scripts/deploy_new.js' });
});

task('deploy:update', 'Deploy logic contract for contract update', async () => {
  await hre.run('run', { script: 'scripts/deploy_update.js' });
});

task('deploy:test:logic', 'Deploy logic contract for testing purposes', async () => {
  await hre.run('run', { script: 'scripts/deploy_test_logic.js' });
});

task('deploy:test:governance', 'Deploy governance contract for testing purposes', async () => {
  await hre.run('run', { script: 'scripts/deploy_test_governance.js' });
});

task('deploy:test', 'Deploy logic contract for testing purposes', async () => {
  await hre.run('deploy:test:logic');
});

module.exports = {
  defaultNetwork: 'hardhat',
  networks,
  solidity: {
    version: '0.8.6',
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
  mocha: {
    timeout: 10 * 60 * 1000, // 10 minutes
  },
  docgen: {
    path: './docs',
    clear: true,
    runOnCompile: false,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  gasReporter: {
    currency: 'USD',
  },
};
