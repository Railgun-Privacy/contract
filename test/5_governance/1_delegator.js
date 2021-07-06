/* global describe it beforeEach ethers */
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

const { expect } = require('chai');

const abiCoder = new ethers.utils.AbiCoder();

let delegator;
let delegatorAdmin;
let targetAlpha;
let targetNumber;

describe('Governance/Delegator', () => {
  beforeEach(async () => {
    const Delegator = await ethers.getContractFactory('Delegator');
    const TargetAlpha = await ethers.getContractFactory('GovernanceTargetAlphaStub');
    const TargetNumber = await ethers.getContractFactory('GovernanceTargetNumberStub');

    delegator = await Delegator.deploy(
      (await ethers.getSigners())[1].address,
    );

    delegatorAdmin = delegator.connect((await ethers.getSigners())[1]);

    targetAlpha = await TargetAlpha.deploy();
    targetNumber = await TargetNumber.deploy();
  });

  it('Should set permissions', async () => {
    expect(await delegator.checkPermission(
      (await ethers.getSigners())[0].address,
      targetAlpha.address,
      targetAlpha.interface.getSighash('a()'),
    )).to.equal(false);

    await delegatorAdmin.setPermission(
      (await ethers.getSigners())[0].address,
      targetAlpha.address,
      targetAlpha.interface.getSighash('a()'),
      true,
    );

    expect(await delegator.checkPermission(
      (await ethers.getSigners())[0].address,
      targetAlpha.address,
      targetAlpha.interface.getSighash('a()'),
    )).to.equal(true);
  });

  it('Should be able to call function with permission', async () => {
    await delegatorAdmin.setPermission(
      (await ethers.getSigners())[0].address,
      targetAlpha.address,
      targetAlpha.interface.getSighash('a()'),
      true,
    );

    // eslint-disable-next-line no-unused-expressions
    await expect(
      delegator.callContract(targetAlpha.address, targetAlpha.interface.getSighash('a()'), []),
    ).to.eventually.be.fulfilled;
  });

  it('Should be able to call function with wildcard contract permission', async () => {
    await delegatorAdmin.setPermission(
      (await ethers.getSigners())[0].address,
      '0x0000000000000000000000000000000000000000',
      targetAlpha.interface.getSighash('a()'),
      true,
    );

    // eslint-disable-next-line no-unused-expressions
    await expect(
      delegator.callContract(targetAlpha.address, targetAlpha.interface.getSighash('a()'), []),
    ).to.eventually.be.fulfilled;

    // eslint-disable-next-line no-unused-expressions
    await expect(
      delegator.callContract(targetNumber.address, targetAlpha.interface.getSighash('a()'), []),
    ).to.eventually.be.fulfilled;
  });

  it('Should be able to call function with wildcard function permission', async () => {
    await delegatorAdmin.setPermission(
      (await ethers.getSigners())[0].address,
      targetAlpha.address,
      '0x00000000',
      true,
    );

    // eslint-disable-next-line no-unused-expressions
    await expect(
      delegator.callContract(targetAlpha.address, targetAlpha.interface.getSighash('a()'), []),
    ).to.eventually.be.fulfilled;

    // eslint-disable-next-line no-unused-expressions
    await expect(
      delegator.callContract(targetAlpha.address, targetAlpha.interface.getSighash('b()'), []),
    ).to.eventually.be.fulfilled;
  });

  it('Should intercept calls to self correctly', async () => {
    const callData = abiCoder.encode([
      'address',
      'address',
      'bytes4',
      'bool',
    ], [
      (await ethers.getSigners())[0].address,
      targetAlpha.address,
      targetAlpha.interface.getSighash('a()'),
      true,
    ]);

    await delegatorAdmin.callContract(
      delegator.address,
      delegator.interface.getSighash('setPermission(address,address,bytes4,bool)'),
      callData,
    );

    // eslint-disable-next-line no-unused-expressions
    await expect(
      delegator.callContract(targetAlpha.address, targetAlpha.interface.getSighash('a()'), []),
    ).to.eventually.be.fulfilled;
  });
});
