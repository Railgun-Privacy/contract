/* eslint-disable no-console */
/* eslint-disable jsdoc/require-jsdoc */
const hre = require('hardhat');
const { ethers } = require('hardhat');

async function main() {
  // Get build artifacts
  const RailToken = await ethers.getContractFactory('RailTokenFixedSupply');
  const Staking = await ethers.getContractFactory('Staking');
  const Voting = await ethers.getContractFactory('Voting');
  const Delegator = await ethers.getContractFactory('Delegator');
  const Treasury = await ethers.getContractFactory('Treasury');
  const ProxyAdmin = await ethers.getContractFactory('ProxyAdmin');
  const Proxy = await ethers.getContractFactory('PausableUpgradableProxy');

  const tokenParams = {
    name: '',
    symbol: '',
    initialSupply: 50000000n * 10n ** 18n,
    initialHolder: '0x0',
  };

  // Deploy RailToken
  const rail = await RailToken.deploy(
    tokenParams.initialHolder,
    tokenParams.initialSupply,
    tokenParams.name,
    tokenParams.symbol,
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

  // Wait for contracts to be deployed
  await rail.deployTransaction.wait();
  await delegator.deployTransaction.wait();
  await proxy.deployTransaction.wait();

  // Transfer ownerships
  await delegator.transferOwnership(voting.address);

  // Transfer proxy ownership
  await (await proxy.transferOwnership(proxyAdmin.address)).wait();

  console.log('RailToken:', rail.address);
  console.log('Staking:', staking.address);
  console.log('Delegator:', delegator.address);
  console.log('Voting:', voting.address);
  console.log('Treasury:', treasury.address);
  console.log('Proxy Admin:', proxyAdmin.address);
  console.log('Proxy:', proxy.address);

  // Verify contracts
  await hre.run('verify:verify', {
    address: rail.address,
    constructorArguments: [
      tokenParams.initialHolder,
      tokenParams.initialSupply,
      tokenParams.name,
      tokenParams.symbol,
    ],
    contract: 'contracts/token/RailFixed.sol:RailTokenFixedSupply',
  });

  await hre.run('verify:verify', {
    address: staking.address,
    constructorArguments: [
      rail.address,
    ],
  });

  await hre.run('verify:verify', {
    address: delegator.address,
    constructorArguments: [
      (await ethers.getSigners())[0].address,
    ],
  });

  await hre.run('verify:verify', {
    address: voting.address,
    constructorArguments: [
      staking.address,
      delegator.address,
    ],
  });

  await hre.run('verify:verify', {
    address: treasury.address,
    constructorArguments: [
      delegator.address,
    ],
  });

  await hre.run('verify:verify', {
    address: proxyAdmin.address,
    constructorArguments: [
      delegator.address,
    ],
  });

  await hre.run('verify:verify', {
    address: proxy.address,
    constructorArguments: [
      (await ethers.getSigners())[0].address,
    ],
  });
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
