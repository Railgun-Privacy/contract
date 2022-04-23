/* eslint-disable no-console */
/* eslint-disable jsdoc/require-jsdoc */
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
  rail: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  staking: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  delegator: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  voting: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  treasury: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
  implementation: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
  proxyAdmin: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
  proxy: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
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

  await rail.approve(
    staking.address,
    await rail.balanceOf(
      (await ethers.getSigners())[0].address,
    ),
  );

  await staking.stake(
    await rail.balanceOf(
      (await ethers.getSigners())[0].address,
    ),
  );
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

  await voting.executeProposal(proposalID);
}

// eslint-disable-next-line no-unused-vars
async function main() {
  await prep();
  await becomeWhale();
  await stakeAll();
  await fastForward(1);
  const calls = await getProposalCalls();
  const proposalID = await submitProposal(PROPOSALDOCUMENT, calls);
  await passProposal(proposalID);
  await testProposalUpgrade();
  console.log('Tests passed with calls:');
  console.log(calls);
}

// eslint-disable-next-line no-unused-vars
async function submit() {
  await prep();
  const calls = await getProposalCalls();
  const proposalID = await submitProposal(PROPOSALDOCUMENT, calls);
  console.log('Proposal ID: ', proposalID);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});

// submit().then(() => process.exit(0)).catch((error) => {
//   console.error(error);
//   process.exit(1);
// });
