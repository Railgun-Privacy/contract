import readline from 'readline';
import { ethers } from 'hardhat';
import type { Contract } from 'ethers';
import { expect } from 'chai';
import { chainConfigs } from '@railgun-community/deployments';
import { ChainConfig } from '@railgun-community/deployments/dist/types';

import artifacts from './artifacts.json';
import { VerifyingKeyStruct } from '../../typechain-types/contracts/logic/RailgunLogic';
const ARTIFACT_BATCH_SIZE = 5;

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
  const VKeySetter = await ethers.getContractFactory('VKeySetter');
  const vkeySetter = await VKeySetter.deploy(
    (
      await ethers.getSigners()
    )[0].address,
    chainConfig.delegator.address,
    chainConfig.proxy.address,
  );

  await logVerify('VKeySetter', vkeySetter, [
    (await ethers.getSigners())[0].address,
    chainConfig.delegator.address,
    chainConfig.proxy.address,
  ]);

  NEW_DEPLOYMENTS.vkeySetter = vkeySetter.address;

  let nonce = await vkeySetter.signer.getTransactionCount();
  const transactions = [];

  for (let i = 0; i < artifacts.length; i += ARTIFACT_BATCH_SIZE) {
    const chunk = artifacts.slice(i, i + ARTIFACT_BATCH_SIZE);
    transactions.push(
      (
        await vkeySetter.batchSetVerificationKey(
          chunk.map((artifact) => artifact.nullifiers),
          chunk.map((artifact) => artifact.commitments),
          chunk.map((artifact) => artifact.contractVKey as VerifyingKeyStruct),
          { nonce },
        )
      ).wait(),
    );
    nonce += 1;
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
  }

  await Promise.all(transactions);
}

/**
 * Test actions
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function testExecution(chainConfig: ChainConfig) {
  const vkeySetter = await ethers.getContractAt('VKeySetter', NEW_DEPLOYMENTS.vkeySetter);

  expect((await vkeySetter.verifier()).toLowerCase()).to.equal(
    chainConfig.proxy.address.toLowerCase(),
  );
  expect((await vkeySetter.delegator()).toLowerCase()).to.equal(
    chainConfig.delegator.address.toLowerCase(),
  );

  for (const artifact of artifacts) {
    const key = await vkeySetter.getVerificationKey(artifact.nullifiers, artifact.commitments);
    expect(key.artifactsIPFSHash).to.equal(artifact.contractVKey.artifactsIPFSHash);
    expect(key.alpha1.x).to.equal(artifact.contractVKey.alpha1.x);
    expect(key.beta2.x[0]).to.equal(artifact.contractVKey.beta2.x[0]);
    expect(key.ic.length).to.equal(artifact.contractVKey.ic.length);
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
