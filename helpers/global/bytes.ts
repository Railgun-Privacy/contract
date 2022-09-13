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

/**
 * Convert byte array to hex string
 *
 * @param array - byte array
 * @param prefix - prefix with 0x
 * @returns hex string
 */
function arrayToHexString(array: Uint8Array, prefix: boolean) {
  // Create empty hex string
  let hexString = '';

  // Loop through each byte of array
  array.forEach((byte) => {
    // Convert integer representation to base 16
    let hexByte = byte.toString(16);

    // Ensure 2 chars
    hexByte = hexByte.length === 1 ? '0' + hexByte : hexByte;

    // Append to hexString
    hexString += hexByte;
  });

  // Prefix if needed
  return prefix ? `0x${hexString}` : hexString;
}

/**
 * Convert hex string to byte array
 *
 * @param hexString - hex string
 * @returns byte array
 */
function hexStringToArray(hexString: string) {
  // Strip leading 0x if present
  const hexStringFormatted = hexString.startsWith('0x') ? hexString.slice(2) : hexString;

  // Create empty array
  const array = new Uint8Array(hexStringFormatted.length / 2);

  // Fetch matching byte index from hex string and parse to integer
  array.map(
    (element, index) => (array[index] = parseInt(hexStringFormatted.substring(index * 2, 2), 16)),
  );

  return array;
}

export { arrayToByteLength, arrayToBigInt, bigIntToArray, arrayToHexString, hexStringToArray };
