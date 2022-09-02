import crypto from 'crypto';
import { ethers } from 'hardhat';
import { eddsa, poseidon } from 'circomlibjs';
import { toBufferBE } from 'bigint-buffer';

/**
 * Generates random eddsa-babyjubjub privateKey
 *
 * @returns private key
 */
function genRandomPrivateKey(): Buffer {
  return crypto.randomBytes(32);
}

/**
 * Convert babyjubjub private key to public key
 *
 * @param privateKey - babyjubjub private key
 * @returns public key
 */
function privateKeyToPublicKey(privateKey: Buffer): Buffer[] {
  return eddsa
    .prv2pub(Buffer.from(ethers.BigNumber.from(privateKey).toHexString().slice(2), 'hex'))
    .map((el) => toBufferBE(el, 32));
}

/**
 * Generates a random babyJubJub point
 *
 * @returns random point
 */
function genRandomPoint(): Buffer {
  return toBufferBE(poseidon([BigInt(`0x${crypto.randomBytes(32).toString('hex')}`)]), 32);
}

export { genRandomPrivateKey, privateKeyToPublicKey, genRandomPoint };
