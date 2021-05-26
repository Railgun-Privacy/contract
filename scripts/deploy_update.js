/* eslint-disable no-console */
/* eslint-disable jsdoc/require-jsdoc */
/* global overwriteArtifact ethers */
const hre = require('hardhat');
const poseidonGenContract = require('circomlib/src/poseidon_gencontract');
const deployConfig = require('../deploy.config');

async function main() {
  await hre.run('compile');

  // Deploy Poseidon library
  await overwriteArtifact(
    'PoseidonT3',
    poseidonGenContract.createCode(2),
  );

  await overwriteArtifact(
    'PoseidonT6',
    poseidonGenContract.createCode(5),
  );

  const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
  const poseidonT3 = await PoseidonT3.deploy();
  const PoseidonT6 = await ethers.getContractFactory('PoseidonT6');
  const poseidonT6 = await PoseidonT6.deploy();

  // Deploy Railgun Logic
  const RailgunLogic = await ethers.getContractFactory('RailgunLogic', {
    libraries: {
      PoseidonT3: poseidonT3.address,
      PoseidonT6: poseidonT6.address,
    },
  });

  const railgunLogic = await RailgunLogic.deploy();

  await railgunLogic.initializeRailgunLogic(deployConfig.initialWhitelist, '0x0000000000000000000000000000000000000000', 0n, {
    gasLimit: 4000000,
  });

  console.log('Railgun logic contract:', railgunLogic.address);

  console.log('Submit new logic contract address as upgrade to governance contract');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
