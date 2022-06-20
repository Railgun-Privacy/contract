import {ethers} from 'hardhat';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {Contract} from 'ethers';

chai.use(chaiAsPromised);

const {expect} = chai;

let deployer: Contract;

describe('Governance/Deployer', () => {
  beforeEach(async () => {
    const Deployer = await ethers.getContractFactory('Deployer');

    deployer = await Deployer.deploy((await ethers.getSigners())[0].address);
  });

  it('Should deploy contracts at expected address', async () => {
    const salt = ethers.constants.HashZero;
    const Target = await ethers.getContractFactory('GovernanceTargetConstructorArgumentStub');

    await deployer.deploy(0n, salt, Target.getDeployTransaction('hello').data);

    const target = Target.attach(
      deployer.getAddressFromBytecode(salt, Target.getDeployTransaction('hello').data)
    );

    expect(await target.greeting()).to.equal('hello');
  });
});
