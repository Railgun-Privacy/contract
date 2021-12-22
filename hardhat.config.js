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

task('deploy:test', 'Deploy full deployment for testing purposes', async () => {
  await hre.run('run', { script: 'scripts/deploy_test.js' });
});

task('forktoken', 'Gives 100m balance to address[0] when running in fork mode', async () => {
  await hre.run('run', { script: 'scripts/grant_balance.js' });
});

task('fastforward', 'Fast forwards time')
  .addParam('days', 'Days to fast forward (accepts decimal values)')
  .setAction(async (taskArguments, hre) => {
    await hre.ethers.provider.send('evm_increaseTime', [
      Math.round(86400 * taskArguments.days),
    ]);
    console.log(`Fast forwarded ${Math.round(86400 * taskArguments.days)} seconds`);
    await hre.ethers.provider.send('evm_mine');
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
