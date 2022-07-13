/* eslint-disable no-console */
/* eslint-disable jsdoc/require-jsdoc */
const readline = require('readline');
const hre = require('hardhat');
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
  betaProxy: '0xbf0af567d60318f66460ec78b464589e3f9da48e',
  proxy: '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9',
  proxyAdmin: '0x4f8e20f55f879bee7bc010bd6bd2138b34ac65c8',
  rail: '0xe76c6c83af64e4c60245d8c7de953df673a7a33d',
  staking: '0xee6a649aa3766bd117e12c161726b693a1b2ee20',
  treasury: '0xc851fbe0f07a326ce0326ccc70c2a62732e74d6c',
  voting: '0xfc4b580c9bda2eef4e94d9fb4bcb1f7a61660cf9',
};

const PROPOSALDOCUMENT = '';

const BALANCE_SLOT = 1;

const NEW_DEPLOYMENTS = {};

const PAYMENT_CONFIG = [
  {
    to: '0xaE8A17EB859E024cF6B541802B08932B2268dcEe',
    token: '0x6b175474e89094c44da98b954eedeac495271d0f',
    amount: 925000n * 10n ** 18n,
    interval: 1n, // Single payout
    payouts: 1n,
    startTime: 1657800000n, // Thursday, July 14, 2022 12:00:00 PM UTC
  },
  {
    to: '0x5a02474A3083Bc969f20F92E7a8bd3824EC607f0',
    token: '0x6b175474e89094c44da98b954eedeac495271d0f',
    amount: 75000n * 10n ** 18n,
    interval: 1n, // Single payout
    payouts: 1n,
    startTime: 1657800000n, // Thursday, July 14, 2022 12:00:00 PM UTC
  },
  {
    to: '0xA4f2eA0a81179362558eBC1d2Bc817c9a0134ee3',
    token: '0x6b175474e89094c44da98b954eedeac495271d0f',
    amount: 100000n * 10n ** 18n,
    interval: 1n, // Single payout
    payouts: 1n,
    startTime: 1657800000n, // Thursday, July 14, 2022 12:00:00 PM UTC
  },
  {
    to: '0xaE8A17EB859E024cF6B541802B08932B2268dcEe',
    token: '0x6b175474e89094c44da98b954eedeac495271d0f',
    amount: 1850000n * 10n ** 18n,
    interval: 23650000n, // 9 months
    payouts: 3n,
    startTime: 1669625000n, // Monday, November 28, 2022 8:43:20 AM UTC
  },
  {
    to: '0x5a02474A3083Bc969f20F92E7a8bd3824EC607f0',
    token: '0x6b175474e89094c44da98b954eedeac495271d0f',
    amount: 150000n * 10n ** 18n,
    interval: 23650000n, // 9 months
    payouts: 3n,
    startTime: 1669625000n, // Monday, November 28, 2022 8:43:20 AM UTC
  },
  {
    to: '0xA4f2eA0a81179362558eBC1d2Bc817c9a0134ee3',
    token: '0x6b175474e89094c44da98b954eedeac495271d0f',
    amount: 200000n * 10n ** 18n,
    interval: 23650000n, // 9 months
    payouts: 3n,
    startTime: 1669625000n, // Monday, November 28, 2022 8:43:20 AM UTC
  },
];

function logVerify(verifyDetails) {
  console.log('\nVerification Details:');
  console.dir(verifyDetails, { depth: null });
}

async function prep() {
  // Get new contracts to deploy
  const Treasury = await ethers.getContractFactory('Treasury');
  const Proxy = await ethers.getContractFactory('PausableUpgradableProxy');
  const TreasuryMigration = await ethers.getContractFactory('TreasuryMigration');

  // Deploy proxy and implementation
  const treasuryImplementation = await Treasury.deploy();
  const treasuryProxy = await Proxy.deploy((await ethers.getSigners())[0].address);
  await treasuryProxy.deployTransaction.wait();

  // Set proxy implementation
  await treasuryProxy.upgrade(treasuryImplementation.address);
  await treasuryProxy.unpause();
  await (await treasuryProxy.transferOwnership(DEPLOYCONFIG.proxyAdmin)).wait();

  // Initialize treasury owner as governance
  const newTreasury = Treasury.attach(treasuryProxy.address);
  await newTreasury.initializeTreasury(DEPLOYCONFIG.delegator);

  // Deploy treasury migration contract
  const treasuryMigration = await TreasuryMigration.deploy(
    DEPLOYCONFIG.treasury,
    newTreasury.address,
  );
  await treasuryMigration.deployTransaction.wait();

  // Deploy payout contracts
  const IntervalPayouts = await ethers.getContractFactory('IntervalPayouts');
  NEW_DEPLOYMENTS.intervalPayouts = [];
  await Promise.all(PAYMENT_CONFIG.map(async (payout) => {
    const intervalPayouts = await IntervalPayouts.deploy(
      newTreasury.address,
      payout.to,
      payout.token,
      payout.amount,
      payout.interval,
      payout.payouts,
      payout.startTime,
    );

    await intervalPayouts.deployTransaction.wait();

    logVerify({
      address: treasuryProxy.address,
      constructorArguments: [
        newTreasury.address,
        payout.to,
        payout.amount,
        payout.interval,
        payout.payouts,
        payout.startTime,
      ],
    });

    NEW_DEPLOYMENTS.intervalPayouts.push(intervalPayouts.address);
  }));

  // Verify contracts on etherscan
  logVerify({
    address: treasuryImplementation.address,
  });

  logVerify({
    address: treasuryProxy.address,
    constructorArguments: [
      (await ethers.getSigners())[0].address,
    ],
  });

  logVerify({
    address: treasuryMigration.address,
    constructorArguments: [
      DEPLOYCONFIG.treasury,
      newTreasury.address,
    ],
  });

  // Store new deployments
  NEW_DEPLOYMENTS.treasuryImplementation = treasuryImplementation.address;
  NEW_DEPLOYMENTS.treasuryProxy = treasuryProxy.address;
  NEW_DEPLOYMENTS.treasuryMigration = treasuryMigration.address;

  console.log(NEW_DEPLOYMENTS);
}

async function getProposalCalls() {
  const railgunLogicArtifact = hre.artifacts.readArtifactSync('RailgunLogic');
  const railgunInterface = new ethers.utils.Interface(railgunLogicArtifact.abi);
  const oldTreasury = (await ethers.getContractFactory('TreasuryOld')).attach(DEPLOYCONFIG.treasury);
  const newTreasury = (await ethers.getContractFactory('Treasury')).attach(NEW_DEPLOYMENTS.treasuryProxy);

  const TRANSFER_ROLE = await newTreasury.TRANSFER_ROLE();

  const intervalPayoutCalls = NEW_DEPLOYMENTS.intervalPayouts.map((payoutContract) => ({
    callContract: NEW_DEPLOYMENTS.treasuryProxy,
    data: newTreasury.interface.encodeFunctionData('grantRole(bytes32,address)', [
      TRANSFER_ROLE,
      payoutContract,
    ]),
    value: 0,
  }));

  return [
    // Change treasury to new treasury
    {
      callContract: DEPLOYCONFIG.proxy,
      data: railgunInterface.encodeFunctionData('changeTreasury(address)', [NEW_DEPLOYMENTS.treasuryProxy]),
      value: 0,
    },
    {
      callContract: DEPLOYCONFIG.betaProxy,
      data: railgunInterface.encodeFunctionData('changeTreasury(address)', [NEW_DEPLOYMENTS.treasuryProxy]),
      value: 0,
    },
    // Transfer ownership of old treasury to treasury migrator contract
    {
      callContract: DEPLOYCONFIG.treasury,
      data: oldTreasury.interface.encodeFunctionData('transferOwnership(address)', [NEW_DEPLOYMENTS.treasuryMigration]),
      value: 0,
    },
    // Give interval payout contracts the right to access treasury funds
    ...intervalPayoutCalls,
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

async function adminDeployToRopsten() {
  console.log('\nRUNNING PREP');
  await prep();
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
