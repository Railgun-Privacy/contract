import readline from 'readline';
import type { Contract } from 'ethers';
import { expect } from 'chai';
import { chainConfigs } from '@railgun-community/deployments';
import { ChainConfig } from '@railgun-community/deployments/dist/types';
import { mine } from '@nomicfoundation/hardhat-network-helpers';

// Store new deployments here as contract name : address KV pairs
const NEW_DEPLOYMENTS: Record<string, string> = {};

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

/**
 * Execute actions
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function execute(chainConfig: ChainConfig) {
  // EXECUTE ACTIONS
  expect(typeof chainConfig).to.equal('object');
  NEW_DEPLOYMENTS.a = 'a';
  console.log(logVerify);
  await mine();
}

/**
 * Test actions
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function testExecution(chainConfig: ChainConfig) {
  // WRITE TESTS TO CHECK FOR SUCCESSFUL EXECUTION HERE
  expect(typeof chainConfig).to.equal('object');
  await mine();
}

/**
 * Readline prompt the user
 *
 * @param question - question to ask
 * @returns answer
 */
async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = String(
    await new Promise((resolve) => {
      rl.question(question, resolve);
    }),
  );

  rl.close();

  return answer;
}

/**
 * Submit proposal on chain
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function submit(chainConfig: ChainConfig) {
  console.log('\nEXECUTING ACTIONS');
  await execute(chainConfig);
}

/**
 * Submits, passes, and runs tests against proposal
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function test(chainConfig: ChainConfig) {
  console.log('\nEXECUTING ACTIONS');
  await execute(chainConfig);

  console.log('\nTESTING ACTIONS SUBMITTED CORRECTLY');
  await testExecution(chainConfig);
}

/**
 * Entrypoint
 *
 * @returns complete
 */
async function entry() {
  // Get action
  console.log();
  console.log('What action should be taken?');
  console.log('1 = Deploy live');
  console.log('2 = Run tests locally');
  const action = await prompt('Make a selection: ');
  console.log();
  if (!['1', '2'].includes(action)) {
    throw new Error('Unknown Action');
  }

  // Get network
  console.log();
  console.log('What network deploy config should be used?');
  Object.keys(chainConfigs).forEach((network) => {
    if (!/^\d+$/.test(network)) console.log(`- ${network}`);
  });
  const network = await prompt('Make a selection: ');
  console.log();

  // Check if network exists
  const chainConfig = chainConfigs[network];
  if (typeof chainConfig === 'undefined') throw new Error('Unknown Network');

  // Execute action
  if (action == '1') await submit(chainConfig);
  if (action == '2') await test(chainConfig);
}

entry()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
