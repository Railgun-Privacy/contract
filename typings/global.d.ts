// Don't allow Buffers to pass as Uint8Arrays
interface Uint8Array extends Uint8Array {
  slice: undefined;
}
