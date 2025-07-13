import hre from 'hardhat';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, setCode } from '@nomicfoundation/hardhat-network-helpers';
import { Contract } from 'ethers';

import { hash } from '../../../helpers/global/crypto';
import { fromUTF8String, arrayToHexString } from '../../../helpers/global/bytes';

// Define the interface for our CrossDomainMessengerStub
interface CrossDomainMessengerStub extends Contract {
  sendMessage(target: string, message: string, minGasLimit: number): Promise<unknown>;
  getLastMessageDetails(): Promise<[string, string, number]>;
}

describe('Governance/OpStack/Sender', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    // Get addresses
    const [primaryAccount, adminAccount] = await ethers.getSigners();

    // Calculate addresses
    const executorL2address = arrayToHexString(
      hash.keccak256(fromUTF8String('Executor Address')).slice(0, 20),
      true,
    );
    const crossDomainMessengerAddress = arrayToHexString(
      hash.keccak256(fromUTF8String('CrossDomainMessenger Address')).slice(0, 20),
      true,
    );

    // Deploy CrossDomainMessenger stub
    const CrossDomainMessengerStubArtifact = await hre.artifacts.readArtifact(
      'CrossDomainMessengerStub',
    );
    await setCode(crossDomainMessengerAddress, CrossDomainMessengerStubArtifact.deployedBytecode);
    const crossDomainMessengerStub = (await ethers.getContractAt(
      'CrossDomainMessengerStub',
      crossDomainMessengerAddress,
    )) as CrossDomainMessengerStub;

    // Deploy sender
    const Sender = await ethers.getContractFactory('OPStackSender');
    const sender = await Sender.deploy(
      adminAccount.address,
      executorL2address,
      crossDomainMessengerAddress,
    );
    const senderAdmin = sender.connect(adminAccount);

    // Get executor interface
    const OPStackExecutor = await ethers.getContractFactory('OPStackExecutor');

    return {
      primaryAccount,
      adminAccount,
      sender,
      senderAdmin,
      crossDomainMessengerStub,
      executorL2address,
      crossDomainMessengerAddress,
      OPStackExecutor,
    };
  }

  it('Should send ready task message', async () => {
    const { senderAdmin, crossDomainMessengerStub, executorL2address, OPStackExecutor } =
      await loadFixture(deploy);

    // Send ETH to sender
    await senderAdmin.signer.sendTransaction({
      to: senderAdmin.address,
      data: '0x',
      value: 10n ** 18n,
    });

    // Run ready task
    await senderAdmin.readyTask(3);

    // Check values have been changed
    const [target, message, minGasLimit] = await crossDomainMessengerStub.getLastMessageDetails();
    expect(target).to.equal(ethers.utils.getAddress(executorL2address)); // target
    expect(minGasLimit).to.equal(1000000); // minGasLimit
    expect(message).to.equal(OPStackExecutor.interface.encodeFunctionData('readyTask', [3])); // message
  });

  it('Should not allow non-owner to call', async () => {
    const { sender } = await loadFixture(deploy);

    await expect(sender.readyTask(3)).to.be.revertedWith('Ownable: caller is not the owner');
    await expect(sender.setExecutorL2(ethers.constants.AddressZero)).to.be.revertedWith(
      'Ownable: caller is not the owner',
    );
  });

  it('Should not allow setting executor to 0', async () => {
    const { senderAdmin } = await loadFixture(deploy);

    await expect(senderAdmin.setExecutorL2(ethers.constants.AddressZero)).to.be.revertedWith(
      'OPStackSender: Executor address is 0',
    );
  });
});
