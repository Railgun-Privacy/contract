import { arrayToBigInt } from './global/bytes';
import { eddsa } from './global/crypto';

async function main() {
  const sig = await eddsa.signPoseidon(
    new Uint8Array([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      1,
    ]),
    new Uint8Array([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      1,
    ]),
  );
  sig.R8 = sig.R8.map(arrayToBigInt);
  console.log(sig);
}

main();
