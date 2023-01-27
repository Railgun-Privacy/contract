import hre from 'hardhat';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  loadFixture,
  setCode,
  setNextBlockBaseFeePerGas,
} from '@nomicfoundation/hardhat-network-helpers';

import { hash } from '../../../helpers/global/crypto';
import { fromUTF8String, arrayToHexString } from '../../../helpers/global/bytes';

describe('Governance/Arbitrum/Sender', () => {
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
    const arbitrumInbox = arrayToHexString(
      hash.keccak256(fromUTF8String('Arbitrum Inbox')).slice(0, 20),
      true,
    );

    // Deploy inbox stub
    const ArbInboxStub = await hre.artifacts.readArtifact('ArbInboxStub');
    await setCode(arbitrumInbox, ArbInboxStub.deployedBytecode);
    const arbInboxStub = await ethers.getContractAt('ArbInboxStub', arbitrumInbox);

    // Deploy sender
    const Sender = await ethers.getContractFactory('ArbitrumSender');
    const sender = await Sender.deploy(adminAccount.address, executorL2address, arbitrumInbox);
    const senderAdmin = sender.connect(adminAccount);

    // Get executor interface
    const ArbitrumExecutor = await ethers.getContractFactory('ArbitrumExecutor');

    return {
      primaryAccount,
      adminAccount,
      sender,
      senderAdmin,
      arbInboxStub,
      executorL2address,
      arbitrumInbox,
      ArbitrumExecutor,
    };
  }

  it('Should send ready task message', async () => {
    const { senderAdmin, arbInboxStub, executorL2address, ArbitrumExecutor } = await loadFixture(
      deploy,
    );

    // Set ticket ID to 12
    await arbInboxStub.setTicketID(12);

    // Check initial values are 0
    expect(await arbInboxStub.getData()).to.deep.equal([
      ethers.constants.AddressZero,
      0,
      0,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      0,
      0,
      '0x',
    ]);

    // Send ETH to sender
    await senderAdmin.signer.sendTransaction({
      to: senderAdmin.address,
      data: '0x',
      value: 10n ** 18n,
    });

    // Set base fee
    await setNextBlockBaseFeePerGas(100);

    // Run ready task
    await expect(senderAdmin.readyTask(3, { maxFeePerGas: 100 })).to.changeEtherBalances(
      [arbInboxStub.address, senderAdmin.address],
      [200, -200],
    );

    // Check values have been changed
    expect(await arbInboxStub.getData()).to.deep.equal([
      ethers.utils.getAddress(executorL2address),
      0,
      200,
      await senderAdmin.signer.getAddress(),
      await senderAdmin.signer.getAddress(),
      0,
      0,
      ArbitrumExecutor.interface.encodeFunctionData('readyTask', [3]),
    ]);
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
      'ArbitrumSender: Executor address is 0',
    );
  });
});
