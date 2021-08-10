/* eslint-disable no-console */
/* eslint-disable jsdoc/require-jsdoc */
/* global ethers */

async function main() {
  // Get build artifacts
  const TestERC20 = await ethers.getContractFactory('TestERC20');
  const Staking = await ethers.getContractFactory('Staking');
  const Voting = await ethers.getContractFactory('Voting');
  const Delegator = await ethers.getContractFactory('Delegator');
  const Target = await ethers.getContractFactory('GovernanceTargetAlphaStub');

  // Deploy contracts
  const testERC20 = await TestERC20.deploy();
  const staking = await Staking.deploy(testERC20.address);
  const delegator = await Delegator.deploy((await ethers.getSigners())[0].address);
  const voting = await Voting.deploy(staking.address, delegator.address);
  const target = await Target.deploy();

  // Transfer ownership of delegator to voting
  await delegator.transferOwnership(voting.address);

  console.log('TestERC20:', testERC20.address);
  console.log('Staking:', staking.address);
  console.log('Voting:', voting.address);
  console.log('Delegator:', delegator.address);
  console.log('Target:', target.address);

  console.log('Example Target Function Call:', target.interface.encodeFunctionData('a()', []));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
