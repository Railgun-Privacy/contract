import hre from 'hardhat';

before(async () => {
  // Force check for compile for IDE test runners
  await hre.run('compile');

  // Default longtests to complete for IDE test runners
  if (
    !(
      process.env.LONG_TESTS === 'none' ||
      process.env.LONG_TESTS === 'extra' ||
      process.env.LONG_TESTS === 'complete'
    )
  ) {
    process.env.LONG_TESTS = 'complete';
  }
});
