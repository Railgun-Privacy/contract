/* global describe it beforeEach ethers */
const { expect } = require('chai');

let deployer;

describe('Governance/Deployer', () => {
  beforeEach(async () => {
    const Deployer = await ethers.getContractFactory('Deployer');

    deployer = await Deployer.deploy(
      (await ethers.getSigners())[0].address,
    );
  });

  it('Should deploy contracts at expected address', async () => {
    const salt = '0x0000000000000000000000000000000000000000000000000000000000000000';
    const Target = await ethers.getContractFactory('GovernanceTargetConstructorArgumentStub');

    await deployer.deploy(
      0n,
      salt,
      Target.getDeployTransaction('hello').data,
    );

    const target = Target.attach(deployer.getAddressFromBytecode(
      salt,
      Target.getDeployTransaction('hello').data,
    ));

    expect(await target.greeting()).to.equal('hello');
  });
});
