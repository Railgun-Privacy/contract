declare module 'xchacha20-js' {
  declare class XChaCha20 {
    encrypt(message: Buffer, nonce: Buffer, key: Buffer): Promise<Buffer>;
    decrypt(ciphertext: Buffer, nonce: Buffer, key: Buffer): Promise<Buffer>;
  }
}
