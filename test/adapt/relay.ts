import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

describe('Adapt/Relay', () => {
  /**
   * Deploy fixtures
   *
   * @returns fixtures
   */
  async function deploy() {
    const RelayAdapt = await ethers.getContractFactory('RelayAdapt');
  }
});
