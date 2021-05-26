/* eslint-disable no-console */
/* eslint-disable jsdoc/require-jsdoc */
const hre = require('hardhat');

async function main() {
  await hre.run('compile');

  // TODO: Deploy token contract

  // TODO: Deploy logic contract

  // TODO: Deploy governance contract with token contract as voters

  // TODO: Deploy proxy admin contract with governance contract as admin

  // TODO: Deploy proxy contract with proxy admin as admin

  console.log('Railgun logic contract:', logic.address);
  console.log('Railgun proxy contract:', proxy.address);
  console.log('Railgun token contract:', token.address);
  console.log('Railgun governance contract:', governance.address);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
