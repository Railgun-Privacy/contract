import { eddsa } from './global/crypto';
import { arrayToBigInt, bigIntToArray, hexStringToArray } from './global/bytes';

async function main() {
  const key = hexStringToArray('0001020304050607080910111213141516171819202122232425262728293031');
  const message = bigIntToArray(2n ** 248n, 32);

  const sig = await eddsa.signPoseidon(key, message);
  console.log(sig.map(arrayToBigInt));
}

main();
