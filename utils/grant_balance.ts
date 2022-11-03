/* eslint-disable no-console */
/* eslint-disable jsdoc/require-jsdoc */
import { ethers } from 'hardhat';
import { getStorageAt, setStorageAt } from '@nomicfoundation/hardhat-network-helpers';

async function grantBalance(address: string, token: string, balance: bigint) {
  // Format balance
  const balanceFormatted = `0x${balance.toString(16).padStart(64, '0')}`;

  // Get token
  const ERC20 = await ethers.getContractFactory('TestERC20');
  const erc20 = ERC20.attach(token);

  for (let i = 0; i < 1000; i += 1) {
    // Calculate storage slot
    const storageSlot = ethers.utils.solidityKeccak256(
      ['uint256', 'uint256'],
      [(await ethers.getSigners())[0].address, i],
    );

    // Get storage before
    const before = await getStorageAt(token, storageSlot);

    // Set storage
    await setStorageAt(token, storageSlot, balanceFormatted);

    // Check if token balance changed
    if ((await erc20.balanceOf(address)).toBigInt() === balance) break;

    // Restore storage before going to next slot
    await setStorageAt(token, storageSlot, before);
  }
}

export { grantBalance };
