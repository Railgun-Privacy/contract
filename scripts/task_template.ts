import readline from 'readline';
import hre from 'hardhat';
import { ethers } from 'hardhat';
import type { Contract } from 'ethers';
import { expect } from 'chai';
import { chainConfigs, abis } from '@railgun-community/deployments';
import { ChainConfig } from '@railgun-community/deployments/dist/types';
import { grantBalance } from '../hardhat.utils';
import { Voting, ProposalEvent } from '../typechain-types/contracts/governance/Voting';
import { mine } from '@nomicfoundation/hardhat-network-helpers';
import { increase } from '@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time';

// Set this to the proposal document IPFS hash
const PROPOSAL_DOCUMENT = '';

// Store new deployments here as contract name : address KV pairs
const NEW_DEPLOYMENTS: Record<string, string> = {};

// Tasks to execute on L2s
const L2_TASKS: {
  sender: string;
  taskNumber: number;
}[] = [];

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
  NEW_DEPLOYMENTS.a = 'a';
  console.log(logVerify);
  await mine();
}

/**
 * Get proposal calls
 *
 * @param chainConfig - chain config
 * @returns Proposal calls
 */
async function getProposalCalls(chainConfig: ChainConfig): Promise<Voting.CallStruct[]> {
  const sender = await ethers.getContractAt('ISender', ethers.constants.AddressZero);

  // GET L2 TASKS CALLS
  const l2TaskCalls: Voting.CallStruct[] = L2_TASKS.map((task) => {
    return {
      callContract: task.sender,
      data: sender.interface.encodeFunctionData('readyTask', [task.taskNumber]),
      value: 0,
    };
  });

  // REWRITE THE REST OF THIS FUNCTION TO RETURN THE CALLS FOR YOUR PROPOSAL
  // EG UPGRADE IMPLEMENTATION CONTRACT
  const rail = new ethers.Contract(chainConfig.rail.address, abis.rail, ethers.provider);

  const otherCalls: Voting.CallStruct[] = [
    {
      callContract: chainConfig.rail.address,
      data: rail.interface.encodeFunctionData('balanceOf', [
        (await ethers.getSigners())[0].address,
      ]),
      value: 0,
    },
  ];

  // Return
  return [...l2TaskCalls, ...otherCalls];
}

/**
 * Test proposal upgrade
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function testProposalUpgrade(chainConfig: ChainConfig) {
  // WRITE TESTS TO CHECK FOR SUCCESSFUL UPGRADE HERE
  expect(typeof chainConfig).to.equal('object');
  await mine();
}

/**
 * Increase governance token balance for testing
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function becomeWhale(chainConfig: ChainConfig) {
  // Set balance of governance token to 100 million
  await grantBalance(
    hre,
    (
      await ethers.getSigners()
    )[0].address,
    chainConfig.rail.address,
    100000000n * 10n ** 18n,
  );
}

/**
 * Stake all rail tokens
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function stakeAll(chainConfig: ChainConfig) {
  // Get contracts
  const rail = (await ethers.getContractFactory('TestERC20')).attach(chainConfig.rail.address);
  const staking = (await ethers.getContractFactory('Staking')).attach(chainConfig.staking.address);

  // Approve and stake all rail rail
  await (
    await rail.approve(
      staking.address,
      await rail.balanceOf((await ethers.getSigners())[0].address),
    )
  ).wait();

  await (await staking.stake(await rail.balanceOf((await ethers.getSigners())[0].address))).wait();
}

/**
 * Submits proposal
 *
 * @param chainConfig - chain config
 * @param calls - calls
 * @returns proposal ID
 */
async function submitProposal(
  chainConfig: ChainConfig,
  calls: Voting.CallStruct[],
): Promise<number> {
  // Get contract
  const voting = (await ethers.getContractFactory('Voting')).attach(chainConfig.voting.address);

  // Submit proposal
  const tx = await voting.createProposal(PROPOSAL_DOCUMENT, calls);
  const result = await tx.wait();

  // Return proposal ID
  const events = result.events as [ProposalEvent];
  return events[0].args.id.toNumber();
}

/**
 * Passes proposal in test environment
 *
 * @param chainConfig - chain config
 * @param proposalID - proposal ID to pass
 * @returns complete
 */
async function passProposal(chainConfig: ChainConfig, proposalID: number) {
  // Get contract
  const voting = (await ethers.getContractFactory('Voting')).attach(chainConfig.voting.address);

  // Get parameters
  const votingStartOffset = await voting.VOTING_START_OFFSET();
  const executionStartOffset = await voting.EXECUTION_START_OFFSET();
  const quorum = await voting.QUORUM();
  const proposalSponsorThreshold = await voting.PROPOSAL_SPONSOR_THRESHOLD();

  // Sponsor and send proposal to vote
  await voting.sponsorProposal(
    proposalID,
    proposalSponsorThreshold,
    (
      await ethers.getSigners()
    )[0].address,
    0n,
  );
  await voting.callVote(proposalID);

  // Increase time to voting start offset
  await increase(votingStartOffset);
  await mine();

  // Vote
  await voting.vote(proposalID, quorum, true, (await ethers.getSigners())[0].address, 0n);

  // Increase time to execution start
  await increase(executionStartOffset.sub(votingStartOffset));

  // Execute
  await (await voting.executeProposal(proposalID)).wait();
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
  console.log('\nRUNNING PREP');
  await prep(chainConfig);

  console.log('\nGETTING PROPOSAL CALLS');
  const calls = await getProposalCalls(chainConfig);

  console.log('\nSUBMITTING PROPOSAL');
  const proposalID = await submitProposal(chainConfig, calls);

  console.log('Proposal ID: ', proposalID);
}

/**
 * Submits, passes, and runs tests against proposal
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function test(chainConfig: ChainConfig) {
  console.log('\nINCREASING RAIL BALANCE FOR VOTE');
  await becomeWhale(chainConfig);

  console.log('\nSTAKING ALL RAIL');
  await stakeAll(chainConfig);

  console.log('\nFAST FORWARDING TO SNAPSHOT');
  await increase(86400);

  console.log('\nRUNNING PREP');
  await prep(chainConfig);

  console.log('\nGETTING PROPOSAL CALLS');
  const calls = await getProposalCalls(chainConfig);

  console.log('\nSUBMITTING PROPOSAL');
  const proposalID = await submitProposal(chainConfig, calls);
  console.log('Proposal ID: ', proposalID);

  console.log('\nPASSING PROPOSAL');
  await passProposal(chainConfig, proposalID);

  console.log('\nTESTING PROPOSAL');
  await testProposalUpgrade(chainConfig);

  console.log('\nTESTS PASSED FOR PROPOSAL CALLS:');
  console.log(calls);
}

/**
 * Deploys proposal to chain where we have admin permissions
 *
 * @param chainConfig - chain config
 * @returns complete
 */
async function adminDeploy(chainConfig: ChainConfig) {
  console.log('\nRUNNING PREP');
  await prep(chainConfig);

  console.log('\nGETTING PROPOSAL CALLS');
  const calls = await getProposalCalls(chainConfig);

  console.log('\nRUNNING CALLS');
  const Delegator = await ethers.getContractFactory('Delegator');
  const delegator = Delegator.attach(chainConfig.delegator.address);

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
