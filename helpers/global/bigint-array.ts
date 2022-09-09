/**
 * Left pads byte array to length
 *
 * @param byteArray - byte array to pad
 * @param length - length of new array
 * @returns padded array
 */
function arrayToByteLength(byteArray: Uint8Array, length: number) {
  // Check the length of array requested is large enough to accommodate the original array
  if (byteArray.length > length) throw new Error('BigInt byte size is larger than length');

  // Create Uint8Array of requested length
  return new Uint8Array(new Array(length - byteArray.length).concat(...byteArray));
}

/**
 * Convert typed byte array to bigint
 *
 * @param array - Array to convert
 * @returns bigint
 */
function arrayToBigInt(array: Uint8Array): bigint {
  // Initialize result as 0
  let result = 0n;

  // Loop through each element in the array
  array.forEach((element) => {
    // Shift result bits left by 1 byte
    result = result << 8n;

    // Add element to result, filling the last bit positions
    result += BigInt(element);
  });
  return result;
}

/**
 * Convert bigint to byte array
 *
 * @param bn - bigint
 * @param length - length of resulting byte array
 * @returns byte array
 */
function bigIntToArray(bn: bigint, length: number): Uint8Array {
  // Convert bigint to hex string
  let hex = BigInt(bn).toString(16);

  // If hex is odd length then add leading zero
  if (hex.length % 2) hex = `0${hex}`;

  // Split into groups of 2 to create hex array
  const hexArray = hex.match(/.{2}/g) ?? [];

  // Convert hex array to uint8 byte array
  const byteArray = new Uint8Array(hexArray.map((byte) => parseInt(byte, 16)));

  return arrayToByteLength(byteArray, length);
}

export { arrayToByteLength, arrayToBigInt, bigIntToArray };
