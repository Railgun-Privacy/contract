/* eslint-disable no-console */
/* eslint-disable jsdoc/require-jsdoc */
const { ethers } = require('hardhat');

const weth9artifact = require('@ethereum-artifacts/weth9');

const artifacts = require('../helpers/logic/snarkKeys');

async function main() {
  // Get signers
  const accounts = await ethers.getSigners();

  // Get build artifacts
  const RailToken = await ethers.getContractFactory('RailTokenDAOMintable');
  const Staking = await ethers.getContractFactory('Staking');
  const Voting = await ethers.getContractFactory('Voting');
  const Delegator = await ethers.getContractFactory('Delegator');
  const Treasury = await ethers.getContractFactory('Treasury');
  const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
  const PoseidonT4 = await ethers.getContractFactory('PoseidonT4');
  const ProxyAdmin = await ethers.getContractFactory('ProxyAdmin');
  const Proxy = await ethers.getContractFactory('PausableUpgradableProxy');
  const RelayAdapt = await ethers.getContractFactory('RelayAdapt');

  console.log('Deploying governance contracts...');

  // Deploy RailToken
  const rail = await RailToken.deploy(
    (await ethers.getSigners())[0].address,
    50000000n * 10n ** 18n,
    100000000n * 10n ** 18n,
    (await ethers.getSigners())[0].address,
    'Rail',
    'RAIL',
  );

  // Deploy Staking
  const staking = await Staking.deploy(rail.address);

  // Deploy delegator
  const delegator = await Delegator.deploy((await ethers.getSigners())[0].address);

  // Deploy voting
  const voting = await Voting.deploy(staking.address, delegator.address);

  // Deploy treasury
  const treasury = await Treasury.deploy(delegator.address);

  // Deploy ProxyAdmin
  const proxyAdmin = await ProxyAdmin.deploy(delegator.address);

  // Deploy Proxy
  const proxy = await Proxy.deploy((await ethers.getSigners())[0].address);

  console.log('Deploying logic contract...');

  // Deploy Poseidon libraries
  const poseidonT3 = await PoseidonT3.deploy();
  const poseidonT4 = await PoseidonT4.deploy();

  // Get Railgun Logic
  const RailgunLogic = await ethers.getContractFactory('RailgunLogicStub', {
    libraries: {
      PoseidonT3: poseidonT3.address,
      PoseidonT4: poseidonT4.address,
    },
  });

  // Deploy Railgun Logic
  const railgunLogic = await RailgunLogic.deploy();

  console.log('Waiting for deployment transactions to be mined...');

  // Wait for contracts to be deployed
  await rail.deployTransaction.wait();
  await delegator.deployTransaction.wait();
  await railgunLogic.deployTransaction.wait();
  await proxy.deployTransaction.wait();

  console.log(`Giving full governance permissions to ${(await ethers.getSigners())[0].address}`);

  // Give deployer address full permissions
  await delegator.setPermission(
    (await ethers.getSigners())[0].address,
    ethers.constants.AddressZero,
    '0x00000000',
    true,
  );

  console.log('Transferring ownership of governance contracts...');

  // Transfer ownerships
  await delegator.transferOwnership(voting.address);
  await rail.transferOwnership(delegator.address);

  console.log('Setting implementation on proxy...');

  // Set proxy implementation
  await (await proxy.upgrade(railgunLogic.address)).wait();
  await (await proxy.unpause()).wait();

  console.log('Transferring proxy ownership...');

  // Transfer proxy ownership
  await (await proxy.transferOwnership(proxyAdmin.address)).wait();

  console.log('Initializing logic contract...');

  // Get Railgun Proxy object
  const railgun = RailgunLogic.attach(proxy.address);

  // Initialize Railgun Logic
  await (await railgun.initializeRailgunLogic(
    treasury.address,
    25n,
    25n,
    25n,
    (await ethers.getSigners())[0].address,
    { gasLimit: 2000000 },
  )).wait();

  console.log('Setting snark verification keys...');

  // Deploy all snark keys
  await artifacts.loadAllArtifacts(railgun);

  console.log('Transferring logic contract ownership...');

  // Transfer Railgun logic ownership
  await (await railgun.transferOwnership(delegator.address)).wait();

  console.log('Deploying WETH9');
  const WETH9 = new ethers.ContractFactory(
    weth9artifact.WETH9.abi,
    weth9artifact.WETH9.bytecode,
    accounts[0],
  );
  const weth9 = await WETH9.deploy();
  await weth9.deployTransaction.wait();

  console.log('Deploying relay adapt...');
  const relayAdapt = await RelayAdapt.deploy(proxy.address, weth9.address);
  await relayAdapt.deployTransaction.wait();

  console.log('\n\nDEPLOYMENT COMPLETE\n\n');

  console.log('RailToken:', rail.address);
  console.log('Staking:', staking.address);
  console.log('Delegator:', delegator.address);
  console.log('Voting:', voting.address);
  console.log('Treasury:', treasury.address);
  console.log('Railgun Logic:', railgunLogic.address);
  console.log('Proxy Admin:', proxyAdmin.address);
  console.log('Proxy:', proxy.address);
  console.log('WETH9:', weth9.address);
  console.log('RelayAdapt:', relayAdapt.address);

  console.log({
    rail: rail.address,
    staking: staking.address,
    delegator: delegator.address,
    voting: voting.address,
    treasury: treasury.address,
    implementation: railgunLogic.address,
    proxyAdmin: proxyAdmin.address,
    proxy: proxy.address,
    weth9: weth9.address,
    relayAdapt: relayAdapt.address,
  });
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
