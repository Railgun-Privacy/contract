import readline from 'readline';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { chainConfigs } from '@railgun-community/deployments';
import { ChainConfig } from '@railgun-community/deployments/dist/types';

import artifacts from './artifacts.json';
import { impersonateAccount, setBalance } from '@nomicfoundation/hardhat-network-helpers';
const ARTIFACT_BATCH_SIZE = 5;

// Store new deployments here as contract name : address KV pairs
const NEW_DEPLOYMENTS: Record<string, string> = {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  vkeySetter: process.env.VKEYSETTER!,
};

/**
 * Execute actions
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function execute(chainConfig: ChainConfig) {
  const vkeySetter = await ethers.getContractAt('VKeySetter', NEW_DEPLOYMENTS.vkeySetter);

  const votingAddress =
    chainConfig.voting.address !== '' ? chainConfig.voting.address : chainConfig.L2Executor.address;

  /* BEGIN HARDHAT TEST OVERRIDES */
  // Simulating state changes of proposal for dev
  await impersonateAccount(chainConfig.delegator.address);
  await setBalance(chainConfig.delegator.address, 10n ** 18n);
  await impersonateAccount(votingAddress);
  await setBalance(votingAddress, 10n ** 18n);
  const delegator = await ethers.getSigner(chainConfig.delegator.address);
  const voting = await ethers.getSigner(votingAddress);
  const delegatorVoting = await ethers.getContractAt(
    'Delegator',
    chainConfig.delegator.address,
    voting,
  );
  const vkeySetterDelegator = await ethers.getContractAt(
    'VKeySetter',
    NEW_DEPLOYMENTS.vkeySetter,
    delegator,
  );
  await delegatorVoting.setPermission(
    NEW_DEPLOYMENTS.vkeySetter,
    chainConfig.proxy.address,
    '0x00000000',
    true,
  );
  await vkeySetterDelegator.stateToCommitting();
  /* END HARDHAT TEST OVERRIDES */

  let nonce = await vkeySetter.signer.getTransactionCount();
  const transactions = [];

  for (let i = 0; i < artifacts.length; i += ARTIFACT_BATCH_SIZE) {
    const chunk = artifacts.slice(i, i + ARTIFACT_BATCH_SIZE);
    transactions.push(
      (
        await vkeySetter.batchCommitVerificationKey(
          chunk.map((artifact) => artifact.nullifiers),
          chunk.map((artifact) => artifact.commitments),
          { nonce },
        )
      ).wait(),
    );
    nonce += 1;
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
  const verifier = await ethers.getContractAt('Verifier', chainConfig.proxy.address);

  for (const artifact of artifacts) {
    const key = await verifier.getVerificationKey(artifact.nullifiers, artifact.commitments);
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
