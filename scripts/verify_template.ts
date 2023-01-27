import hre from 'hardhat';

const deployments = [
  {
    address: '',
    constructorArguments: [],
  },
];

for (const deployment of deployments) {
  hre
    .run('verify:verify', deployment)
    .then(() => {
      console.log(`Verified of ${deployment.address}`);
    })
    .catch((e) => {
      console.log(`Verification of ${deployment.address} failed with ${JSON.stringify(e, null, 2)}`);
    });
}
