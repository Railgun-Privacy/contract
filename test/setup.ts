import hre from 'hardhat';

before(async () => {
  // Force check for compile for IDE test runners
  await hre.run('compile');

  // Default to longtests for IDE test runners
  if (process.env.LONG_TESTS !== 'no') {
    process.env.LONG_TESTS = 'yes';
  }
});
