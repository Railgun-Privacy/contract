import hre from 'hardhat';

const deployments = [
  {
    address: '',
    constructorArguments: [],
  },
];

async function main() {
  for (const deployment of deployments) {
    await hre
      .run('verify:verify', deployment)
      .then(() => {
        console.log(`Verified of ${deployment.address}`);
      })
      .catch((e) => {
        console.log(
          `Verification of ${deployment.address} failed with ${JSON.stringify(e, null, 2)}`,
        );
      });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
