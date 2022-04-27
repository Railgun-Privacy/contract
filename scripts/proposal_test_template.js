/* eslint-disable no-console */
/* eslint-disable jsdoc/require-jsdoc */
const readline = require('readline');
const { ethers } = require('hardhat');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = chai;

ethers.provider = new ethers.providers.JsonRpcProvider({
  url: ethers.provider.connection.url,
  timeout: 2147483647,
});

const DEPLOYCONFIG = {
  delegator: '0xb6d513f6222ee92fff975e901bd792e2513fb53b',
  implementation: '0xc6368d9998ea333b37eb869f4e1749b9296e6d09',
  proxy: '0xbf0Af567D60318f66460Ec78b464589E3f9dA48e',
  proxyAdmin: '0x4f8e20f55f879bee7bc010bd6bd2138b34ac65c8',
  rail: '0xe76c6c83af64e4c60245d8c7de953df673a7a33d',
  staking: '0xee6a649aa3766bd117e12c161726b693a1b2ee20',
  treasury: '0xc851fbe0f07a326ce0326ccc70c2a62732e74d6c',
  voting: '0xfc4b580c9bda2eef4e94d9fb4bcb1f7a61660cf9',
};

const PROPOSALDOCUMENT = 'QmSnuWmxptJZdLJpKRarxBMS2Ju2oANVrgbr2xWbie9b2D';

const BALANCE_SLOT = 1;

async function prep() {
  // WRITE PREPARATION CODE FOR TEST (EG DEPLOY IMPLEMENTATION CONTRACT FOR UPGRADE)
}

async function getProposalCalls() {
  // REWRITE THIS FUNCTION TO RETURN THE CALLS FOR YOUR PROPOSAL
  // EG UPGRADE IMPLREMENTATION CONTRACT
  const rail = (await ethers.getContractFactory('TestERC20')).attach(DEPLOYCONFIG.rail);

  return [
    {
      callContract: DEPLOYCONFIG.rail,
      data: rail.interface.encodeFunctionData('balanceOf(address)', [(await ethers.getSigners())[0].address]),
      value: 0,
    },
  ];
}

async function testProposalUpgrade() {
  // WRITE TESTS TO CHECK FOR SUCCESSFUL UPGRADE HERE
  expect(3).to.equal(3);
}

async function becomeWhale() {
  const newBalance = '0x00000000000000000000000000000000000000000052b7d2dcc80cd2e4000000';

  const index = ethers.utils.solidityKeccak256(
    ['uint256', 'uint256'],
    [(await ethers.getSigners())[0].address, BALANCE_SLOT],
  );

  await ethers.provider.send('hardhat_setStorageAt', [
    DEPLOYCONFIG.rail,
    index,
    newBalance,
  ]);

  await ethers.provider.send('evm_mine');
}

async function fastForward(days) {
  await ethers.provider.send('evm_increaseTime', [
    Math.round(86400 * days),
  ]);

  await ethers.provider.send('evm_mine');
}

async function stakeAll() {
  const rail = (await ethers.getContractFactory('TestERC20')).attach(DEPLOYCONFIG.rail);
  const staking = (await ethers.getContractFactory('Staking')).attach(DEPLOYCONFIG.staking);

  (await rail.approve(
    staking.address,
    await rail.balanceOf(
      (await ethers.getSigners())[0].address,
    ),
  )).wait();

  (await staking.stake(
    await rail.balanceOf(
      (await ethers.getSigners())[0].address,
    ),
  )).wait();
}

async function submitProposal(proposalDocument, calls) {
  const voting = (await ethers.getContractFactory('Voting')).attach(DEPLOYCONFIG.voting);

  const voteTX = await voting.createProposal(proposalDocument, calls);
  const result = await voteTX.wait();
  return result.events[0].args.id;
}

async function passProposal(proposalID) {
  const voting = (await ethers.getContractFactory('Voting')).attach(DEPLOYCONFIG.voting);
  const votingStartOffset = await voting.VOTING_START_OFFSET();
  const executionStartOffset = await voting.EXECUTION_START_OFFSET();
  const quorum = await voting.QUORUM();
  const proposalSponsorThreshold = await voting.PROPOSAL_SPONSOR_THRESHOLD();

  await voting.sponsorProposal(proposalID, proposalSponsorThreshold, 0n);
  await voting.callVote(proposalID);

  await ethers.provider.send('evm_increaseTime', [Number(votingStartOffset.toString())]);
  await ethers.provider.send('evm_mine');

  await voting.vote(proposalID, quorum, true, 0n);

  await ethers.provider.send('evm_increaseTime', [
    Number(executionStartOffset.toString())
    - Number(votingStartOffset.toString()),
  ]);

  await (await voting.executeProposal(proposalID)).wait();
}

async function main() {
  console.log('\nRUNNING PREP');
  await prep();
  console.log('\nINCREASING RAIL BALANCE FOR VOTE');
  await becomeWhale();
  console.log('\nSTAKING ALL RAIL');
  await stakeAll();
  console.log('\nFAST FORWARDING TO SNAPSHOT');
  await fastForward(1);
  console.log('\nGETTING PROPOSAL CALLS');
  const calls = await getProposalCalls();
  console.log('\nSUBMITTING PROPOSAL');
  const proposalID = await submitProposal(PROPOSALDOCUMENT, calls);
  console.log('\nPASSING PROPOSAL');
  await passProposal(proposalID);
  console.log('\nTESTING PROPOSAL');
  await testProposalUpgrade();
  console.log('Tests passed with calls:');
  console.log(calls);
}

async function submit() {
  console.log('\nRUNNING PREP');
  await prep();
  console.log('\nGETTING PROPOSAL CALLS');
  const calls = await getProposalCalls();
  console.log('\nSUBMITTING PROPOSAL');
  const proposalID = await submitProposal(PROPOSALDOCUMENT, calls);
  console.log('Proposal ID: ', proposalID);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Yes = Deploy to live; No = Run tests; [y/N]: ', (answer) => {
  rl.close();

  if (answer === 'y' || answer === 'Y') {
    submit().then(() => process.exit(0)).catch((error) => {
      console.error(error);
      process.exit(1);
    });
  } else {
    main().then(() => process.exit(0)).catch((error) => {
      console.error(error);
      process.exit(1);
    });
  }
});
