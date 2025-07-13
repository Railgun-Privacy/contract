import hre from 'hardhat';

before(async () => {
  // Force check for compile for IDE test runners
  await hre.run('compile');
});
