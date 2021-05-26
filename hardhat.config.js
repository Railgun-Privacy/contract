/* global task hre */
const ethers = require('@nomiclabs/hardhat-ethers');
require('@nomiclabs/hardhat-waffle');
require('hardhat-gas-reporter');
require('hardhat-artifactor');
require('hardhat-tracer');
require('hardhat-docgen');

const networks = require('./networks.config');

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

task('deploy:test', 'Deploy logic contract for testing purposes', async () => {
  await hre.run('run', { script: 'scripts/deploy_test.js' });
});

task('test:treerollover', 'Tests tree rollover - this test is run seperately to the mocha suite as it is long running', async () => {
  await hre.run('run', { script: 'test-longrunning/tree_rollover.js' });
});

module.exports = {
  defaultNetwork: 'hardhat',
  networks,
  solidity: {
    version: '0.8.4',
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
    runOnCompile: true,
  },
};
