// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

/**
 * @notice Indexes are 
 */
library Uint80BitMap {
  /**
   * @notice Returns whether the bit at `index` is set
   */
  function getBit(uint80 bitmap, uint16 index) internal pure returns (bool) {
    // Calculate bit mask
    uint80 mask = uint80(0x80000000000000000000) >> index;

    // Return boolean value of bit at index
    return (bitmap & mask) != 0;
  }

  /**
   * @notice Sets the bit at `index` to the boolean `value`
   * @dev since uint80 is a stack element and not a memory pointer the original
   * variable won't be mutated
   */
  function setBit(uint80 bitmap, uint16 index, bool value) internal pure returns (uint80) {
    // Calculate bit mask
    uint80 mask = uint80(0x80000000000000000000) >> index;

    if (value) {
      // If setting to true then OR to always set to 1
      return bitmap |= mask;
    } else {
      // If setting to false then AND the NOT of the mask
      // to always set intended bit to false and leave
      // other bits alone
      return bitmap &= ~mask;
    }
  }
}
