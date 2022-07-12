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
  implementation: '0xbcfa4de73afb071c9ff18a20a22f818e657c541a',
  proxy: '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9',
  proxyAdmin: '0x4f8e20f55f879bee7bc010bd6bd2138b34ac65c8',
  rail: '0xe76c6c83af64e4c60245d8c7de953df673a7a33d',
  staking: '0xee6a649aa3766bd117e12c161726b693a1b2ee20',
  treasury: '0xc851fbe0f07a326ce0326ccc70c2a62732e74d6c',
  voting: '0xfc4b580c9bda2eef4e94d9fb4bcb1f7a61660cf9',
  dai: '0x6b175474e89094c44da98b954eedeac495271d0f',
};

const addresses = [
  '0xaE8A17EB859E024cF6B541802B08932B2268dcEe',
  '0x5a02474A3083Bc969f20F92E7a8bd3824EC607f0',
  '0xA4f2eA0a81179362558eBC1d2Bc817c9a0134ee3',
];

const amountsDai = [
  2800000n * (10n ** 18n),
  1200000n * (10n ** 18n),
  1400000n * (10n ** 18n),
];

const amountsRail = [
  0n,
  0n,
  2250000n * (10n ** 18n),
];

const PROPOSALDOCUMENT = '';

const BALANCE_SLOT = 1;

async function prep() {
  // Mock add Rail balance
  const newBalance = '0x00000000000000000000000000000000000000000001dc74be914d16aa400000';

  const index = ethers.utils.solidityKeccak256(
    ['uint256', 'uint256'],
    [DEPLOYCONFIG.treasury, BALANCE_SLOT],
  );

  await ethers.provider.send('hardhat_setStorageAt', [
    DEPLOYCONFIG.rail,
    index,
    newBalance,
  ]);

  await ethers.provider.send('evm_mine');
}

async function getProposalCalls() {
  const treasury = (await ethers.getContractFactory('Treasury')).attach(DEPLOYCONFIG.treasury);

  const calls = [];

  amountsDai.forEach((amount, index) => {
    if (amount > 0n) {
      calls.push({
        callContract: DEPLOYCONFIG.treasury,
        data: treasury.interface.encodeFunctionData('transferERC20(address,address,uint256)', [
          DEPLOYCONFIG.dai,
          addresses[index],
          amount,
        ]),
        value: 0,
      });
    }
  });

  amountsRail.forEach((amount, index) => {
    if (amount > 0n) {
      calls.push({
        callContract: DEPLOYCONFIG.treasury,
        data: treasury.interface.encodeFunctionData('transferERC20(address,address,uint256)', [
          DEPLOYCONFIG.rail,
          addresses[index],
          amount,
        ]),
        value: 0,
      });
    }
  });

  return calls;
}

async function testProposalUpgrade() {
  const rail = (await ethers.getContractFactory('TestERC20')).attach(DEPLOYCONFIG.rail);
  const dai = (await ethers.getContractFactory('TestERC20')).attach(DEPLOYCONFIG.dai);

  // Check balance increase has happened
  await Promise.all(amountsDai.map(async (amount, addressIndex) => {
    expect(await dai.balanceOf(addresses[addressIndex])).to.equal(amount);
  }));

  await Promise.all(amountsRail.map(async (amount, addressIndex) => {
    expect(await rail.balanceOf(addresses[addressIndex])).to.equal(amount);
  }));
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
  console.log('\nGETTING PROPOSAL CALLS');
  const calls = await getProposalCalls();
  console.log('\nSUBMITTING PROPOSAL');
  const proposalID = await submitProposal(PROPOSALDOCUMENT, calls);
  console.log('Proposal ID: ', proposalID);
}

async function adminDeployToRopsten() {
  console.log('\nGETTING PROPOSAL CALLS');
  const calls = await getProposalCalls();
  console.log('\nRUNNING CALLS');
  const Delegator = await ethers.getContractFactory('Delegator');
  const delegator = await Delegator.attach(DEPLOYCONFIG.delegator);
  console.log(delegator.signer.address);
  for (let i = 0; i < calls.length; i += 1) {
    console.log(calls[i]);
    // eslint-disable-next-line no-await-in-loop
    await (
      // eslint-disable-next-line no-await-in-loop
      await delegator.callContract(calls[i].callContract, calls[i].data, calls[i].value)
    ).wait();
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('1 = Deploy live');
console.log('2 = Deploy to ropsten as admin');
console.log('Other = Run tests locally');
rl.question('Make a selection: ', (answer) => {
  rl.close();

  if (answer === '1') {
    submit().then(() => process.exit(0)).catch((error) => {
      console.error(error);
      process.exit(1);
    });
  } else if (answer === '2') {
    adminDeployToRopsten().then(() => process.exit(0)).catch((error) => {
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
