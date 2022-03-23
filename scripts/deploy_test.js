/* eslint-disable no-console */
/* eslint-disable jsdoc/require-jsdoc */
/* global overwriteArtifact ethers */
const poseidonGenContract = require('circomlib/src/poseidon_gencontract');
const verificationKey = require('../verificationKey');

async function main() {
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

  // Deploy Poseidon library
  await overwriteArtifact(
    'PoseidonT3',
    poseidonGenContract.createCode(2),
  );

  await overwriteArtifact(
    'PoseidonT4',
    poseidonGenContract.createCode(3),
  );

  // Deploy Poseidon libraries
  const poseidonT3 = await PoseidonT3.deploy();
  const poseidonT4 = await PoseidonT4.deploy();

  // Get Railgun Logic
  const RailgunLogic = await ethers.getContractFactory('RailgunLogic', {
    libraries: {
      PoseidonT3: poseidonT3.address,
      PoseidonT4: poseidonT4.address,
    },
  });

  // Deploy Railgun Logic
  const railgunLogic = await RailgunLogic.deploy();

  // Wait for contracts to be deployed
  await rail.deployTransaction.wait();
  await delegator.deployTransaction.wait();
  await railgunLogic.deployTransaction.wait();
  await proxy.deployTransaction.wait();

  // Give deployer address full permissions
  await delegator.setPermission(
    (await ethers.getSigners())[0].address,
    '0x0000000000000000000000000000000000000000',
    '0x00000000',
    true,
  );

  // Transfer ownerships
  await delegator.transferOwnership(voting.address);
  await rail.transferOwnership(delegator.address);

  // Set proxy implementation
  await (await proxy.upgrade(railgunLogic.address)).wait();
  await (await proxy.unpause()).wait();

  // Get Railgun Proxy object
  const railgun = RailgunLogic.attach(proxy.address);

  // Initialize Railgun Logic
  await (await railgun.initializeRailgunLogic(
    verificationKey.vKeySmall,
    verificationKey.vKeyLarge,
    [],
    treasury.address,
    25n,
    25n,
    0n,
    delegator.address,
    { gasLimit: 2000000 },
  )).wait();

  // Transfer proxy ownership
  await (await proxy.transferOwnership(proxyAdmin.address)).wait();

  console.log('RailToken:', rail.address);
  console.log('Staking:', staking.address);
  console.log('Delegator:', delegator.address);
  console.log('Voting:', voting.address);
  console.log('Treasury:', treasury.address);
  console.log('Railgun Logic:', railgunLogic.address);
  console.log('Proxy Admin:', proxyAdmin.address);
  console.log('Proxy:', proxy.address);

  console.log({
    rail: rail.address,
    staking: staking.address,
    delegator: delegator.address,
    voting: voting.address,
    treasury: treasury.address,
    implementation: railgunLogic.address,
    proxyAdmin: proxyAdmin.address,
    proxy: proxy.address,
  });
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
