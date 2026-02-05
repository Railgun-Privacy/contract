import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Registry } from '../../typechain-types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('Registry', function () {
  let registry: Registry;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  // Use dummy addresses
  let contractA: string = '0x0000000000000000000000000000000000000001';
  let contractB: string = '0x0000000000000000000000000000000000000002';

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    const RegistryFactory = await ethers.getContractFactory('Registry');
    registry = (await RegistryFactory.deploy(owner.address)) as Registry;
    await registry.deployed();
  });

  it('should set owner correctly', async function () {
      expect(await registry.owner()).to.equal(owner.address);
  });

  describe('setContract', function () {
      it('should allow owner to set a contract', async function () {
          await expect(registry.setContract('ContractA', contractA, 1))
              .to.emit(registry, 'ContractSet')
              .withArgs('ContractA', contractA, 1, false);
          
          const entry = await registry.getContract('ContractA');

          console.log('Entry', entry)
          expect(entry.implementation).to.equal(contractA);
          expect(entry.version).to.equal(1);
          expect(entry.deprecated).to.be.false;
          expect(entry.name).to.equal('ContractA');
      });

      it('should fail if not owner', async function () {
          await expect(registry.connect(user).setContract('ContractA', contractA, 1))
            .to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('should update existing contract (append new version)', async function () {
          await registry.setContract('ContractA', contractA, 1);
          
          // Set new version
          await registry.setContract('ContractA', contractB, 2);

          const entry = await registry.getContract('ContractA');
          expect(entry.implementation).to.equal(contractB);
          expect(entry.version).to.equal(2);
          
          // Old entry is still in history
          const all = await registry.getAllContracts();
          expect(all.length).to.equal(2); 
      });
  });

  describe('getContractAddress', function () {
      it('should return correct address', async function () {
          await registry.setContract('ContractA', contractA, 1);
          expect(await registry.getContractAddress('ContractA')).to.equal(contractA);
      });

      it('should revert if deprecated', async function () {
          await registry.setContract('ContractA', contractA, 1);
          await registry.deprecateContract('ContractA');
          await expect(registry.getContractAddress('ContractA')).to.be.revertedWith('deprecated.');
      });

      it('should revert if not found', async function () {
          await expect(registry.getContractAddress('NonExistent')).to.be.revertedWith('Contract not found');
      });
  });

  describe('deprecateContract', function () {
      it('should allow owner to deprecate', async function () {
          await registry.setContract('ContractA', contractA, 1);
          await expect(registry.deprecateContract('ContractA'))
              .to.emit(registry, 'ContractDeprecated')
              .withArgs('ContractA', contractA);
          
          const entry = await registry.getContract('ContractA');
          expect(entry.deprecated).to.be.true;
      });

      it('should fail if NOT owner', async function () {
           await registry.setContract('ContractA', contractA, 1);
           await expect(registry.connect(user).deprecateContract('ContractA'))
            .to.be.revertedWith('Ownable: caller is not the owner');
      });
      
      it('should fail if contract not found', async function () {
          await expect(registry.deprecateContract('NonExistent'))
            .to.be.revertedWith('Contract not found');
      });
  });

  describe('getAllContracts', function () {
      it('should return all contracts', async function () {
          await registry.setContract('ContractA', contractA, 1);
          await registry.setContract('ContractB', contractB, 1);

          const entryA = await registry.getContract('ContractA');
          const entryB = await registry.getContract('ContractB');

          console.log('Entry', entryA)
          console.log('EntryB', entryB)

          const all = await registry.getAllContracts();
          expect(all.length).to.equal(2);
          expect(all[0].name).to.equal('ContractA');
          expect(all[1].name).to.equal('ContractB');
      });
  });

});
