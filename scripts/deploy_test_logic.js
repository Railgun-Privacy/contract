/* eslint-disable no-console */
/* eslint-disable jsdoc/require-jsdoc */
/* global overwriteArtifact ethers */
const poseidonGenContract = require('circomlib/src/poseidon_gencontract');
const verificationKey = require('../verificationKey');

async function main() {
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

  const TestERC20 = await ethers.getContractFactory('TestERC20');
  const testERC20 = await TestERC20.deploy();

  // Deploy Railgun Logic
  const RailgunLogic = await ethers.getContractFactory('RailgunLogic', {
    libraries: {
      PoseidonT3: poseidonT3.address,
      PoseidonT6: poseidonT6.address,
    },
  });

  const railgunLogic = await RailgunLogic.deploy();

  await railgunLogic.initializeRailgunLogic(
    verificationKey.vKeySmall,
    verificationKey.vKeyLarge,
    [testERC20.address],
    (await ethers.getSigners())[1].address,
    0n,
    0n,
    0n,
    (await ethers.getSigners())[0].address,
    { gasLimit: 2000000 },
  );
  
  await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);

  console.log('ERC20 Token:', testERC20.address);
  console.log('Railgun:', railgunLogic.address);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
