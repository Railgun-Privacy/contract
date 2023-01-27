import readline from 'readline';
import { ethers } from 'hardhat';
import type { Contract } from 'ethers';
import { expect } from 'chai';
import { chainConfigs, abis } from '@railgun-community/deployments';
import { ChainConfig } from '@railgun-community/deployments/dist/types';
import { IL2Executor } from '../typechain-types/contracts/governance/IL2Executor';

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
 * Run preparation steps
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function prep(chainConfig: ChainConfig) {
  // WRITE PREPARATION CODE FOR TEST (EG DEPLOY IMPLEMENTATION CONTRACT FOR UPGRADE)
  expect(typeof chainConfig).to.equal('object');
  console.log((await ethers.getSigners())[0].address);
  NEW_DEPLOYMENTS.a = 'a';
  console.log(logVerify);
}

/**
 * Get task calls
 *
 * @param chainConfig - chain config
 * @returns Task calls
 */
async function getTaskCalls(chainConfig: ChainConfig): Promise<IL2Executor.ActionStruct[]> {
  // REWRITE THIS FUNCTION TO RETURN THE CALLS FOR YOUR TASK
  // EG UPGRADE IMPLEMENTATION CONTRACT
  const rail = new ethers.Contract(chainConfig.rail.address, abis.rail, ethers.provider);

  const calls: IL2Executor.ActionStruct[] = [
    {
      callContract: chainConfig.rail.address,
      data: rail.interface.encodeFunctionData('balanceOf', [
        (await ethers.getSigners())[0].address,
      ]),
      value: 0,
    },
  ];

  // Return
  return calls;
}

/**
 * Test task execution
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function testTaskExecution(chainConfig: ChainConfig) {
  // WRITE TESTS TO CHECK FOR SUCCESSFUL UPGRADE HERE
  expect(typeof chainConfig).to.equal('object');
  console.log((await ethers.getSigners())[0].address);
}

/**
 * Submit task
 *
 * @param chainConfig - chain config
 * @param calls - calls
 * @returns task ID
 */
async function submitTask(
  chainConfig: ChainConfig,
  calls: IL2Executor.ActionStruct[],
): Promise<string> {
  // Get contract
  const iL2Executor = await ethers.getContractAt('IL2Executor', chainConfig.L2Executor.address);

  // Submit task
  const tx = await iL2Executor.createTask(calls);
  const result = await tx.wait();

  // Return transaction hash
  return result.transactionHash;
}

/**
 * Runs task in fork mode
 *
 * @param chainConfig - chain config
 * @param calls - calls
 * @returns task ID
 */
async function runTaskForkMode(
  chainConfig: ChainConfig,
  calls: IL2Executor.ActionStruct[],
): Promise<void> {
  // Get impersonated signer
  const executorSigner = await ethers.getImpersonatedSigner(chainConfig.L2Executor.address);

  const delegator = (
    await ethers.getContractAt('Delegator', chainConfig.delegator.address)
  ).connect(executorSigner);

  for (const call of calls) {
    console.log(call);
    await (await delegator.callContract(call.callContract, call.data, call.value)).wait();
  }
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
 * Submit task on chain
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function submit(chainConfig: ChainConfig) {
  console.log('\nRUNNING PREP');
  await prep(chainConfig);

  console.log('\nGETTING TASK CALLS');
  const calls = await getTaskCalls(chainConfig);

  console.log('\nSUBMITTING TASK');
  const transactionHash = await submitTask(chainConfig, calls);

  console.log('Task creation transaction: ', transactionHash);
}

/**
 * Submits, passes, and runs tests against task
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function test(chainConfig: ChainConfig) {
  console.log('\nRUNNING PREP');
  await prep(chainConfig);

  console.log('\nGETTING TASK CALLS');
  const calls = await getTaskCalls(chainConfig);

  console.log('\nRUNNING TASK');
  await runTaskForkMode(chainConfig, calls);

  console.log('\nTESTING TASK');
  await testTaskExecution(chainConfig);

  console.log('\nTESTS PASSED FOR TASK CALLS:');
  console.log(calls);
}

/**
 * Deploys task to chain where we have admin permissions
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function adminDeploy(chainConfig: ChainConfig) {
  console.log('\nRUNNING PREP');
  await prep(chainConfig);

  console.log('\nGETTING TASK CALLS');
  const calls = await getTaskCalls(chainConfig);

  console.log('\nRUNNING CALLS');
  const delegator = await ethers.getContractAt('Delegator', chainConfig.delegator.address);

  for (const call of calls) {
    console.log(call);
    await (await delegator.callContract(call.callContract, call.data, call.value)).wait();
  }
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
  console.log('2 = Deploy as admin');
  console.log('3 = Run tests locally');
  const action = await prompt('Make a selection: ');
  console.log();
  if (!['1', '2', '3'].includes(action)) {
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
  if (action == '2') await adminDeploy(chainConfig);
  if (action == '3') await test(chainConfig);
}

entry()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
