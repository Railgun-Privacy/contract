import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

describe('Governance/RailgunRegistry', () => {
  async function deployFixture() {
    const [owner, user] = await ethers.getSigners();
    const RailgunRegistry = await ethers.getContractFactory('RailgunRegistry');
    const registry = await RailgunRegistry.deploy(owner.address);
    await registry.deployed();

    return {
      owner,
      user,
      registry,
      contractA: '0x0000000000000000000000000000000000000001',
      contractB: '0x0000000000000000000000000000000000000002',
    };
  }

  it('marks the branch contract as a mock', async () => {
    const { owner, registry } = await loadFixture(deployFixture);

    expect(await registry.owner()).to.equal(owner.address);
    expect(await registry.isMock()).to.equal(true);
  });

  it('tracks the latest entry for a named contract', async () => {
    const { registry, contractA, contractB } = await loadFixture(deployFixture);

    await expect(registry.setContract('RelayAdapt7702', contractA, 1))
      .to.emit(registry, 'ContractSet')
      .withArgs('RelayAdapt7702', contractA, 1, false);

    expect(await registry.getContractAddress('RelayAdapt7702')).to.equal(contractA);

    await expect(registry.setContract('RelayAdapt7702', contractB, 2))
      .to.emit(registry, 'ContractSet')
      .withArgs('RelayAdapt7702', contractB, 2, false);

    const entry = await registry.getContract('RelayAdapt7702');
    const allContracts = await registry.getAllContracts();

    expect(entry.implementation).to.equal(contractB);
    expect(entry.version).to.equal(2);
    expect(entry.deprecated).to.equal(false);
    expect(await registry.getContractAddress('RelayAdapt7702')).to.equal(contractB);
    expect(allContracts.length).to.equal(2);
  });

  it('keeps owner-only write access', async () => {
    const { registry, user, contractA } = await loadFixture(deployFixture);

    await expect(
      registry.connect(user).setContract('RelayAdapt7702', contractA, 1),
    ).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it('deprecates the latest entry and blocks address lookup', async () => {
    const { registry, contractA } = await loadFixture(deployFixture);

    await registry.setContract('RelayAdapt7702', contractA, 1);

    await expect(registry.deprecateContract('RelayAdapt7702'))
      .to.emit(registry, 'ContractDeprecated')
      .withArgs('RelayAdapt7702', contractA);

    const entry = await registry.getContract('RelayAdapt7702');
    expect(entry.deprecated).to.equal(true);

    await expect(registry.getContractAddress('RelayAdapt7702')).to.be.revertedWith('deprecated.');
  });

  it('reverts for unknown registry names', async () => {
    const { registry } = await loadFixture(deployFixture);

    await expect(registry.getContractAddress('UnknownContract')).to.be.revertedWith(
      'Contract not found',
    );
    await expect(registry.deprecateContract('UnknownContract')).to.be.revertedWith(
      'Contract not found',
    );
  });
});
