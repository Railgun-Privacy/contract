/* eslint-disable no-console */
/* eslint-disable jsdoc/require-jsdoc */
const { ethers } = require('hardhat');

const TOKEN_ADDRESS = '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D';
const BALANCE_SLOT = 1;

async function main() {
  const newBalance = '0x00000000000000000000000000000000000000000052b7d2dcc80cd2e4000000';

  const index = ethers.utils.solidityKeccak256(
    ['uint256', 'uint256'],
    [(await ethers.getSigners())[0].address, BALANCE_SLOT],
  );

  await ethers.provider.send('hardhat_setStorageAt', [
    TOKEN_ADDRESS,
    index,
    newBalance,
  ]);

  await ethers.provider.send('evm_mine');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
