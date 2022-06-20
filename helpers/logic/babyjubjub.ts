/* eslint-disable no-bitwise */
import crypto from 'crypto';
import {ethers} from 'hardhat';
import {eddsa, poseidon} from 'circomlibjs';

/**
 * Generates random babyjubjub privateKey
 *
 * @returns private key
 */
export const genRandomPrivateKey = (): bigint => {
  return BigInt(`0x${crypto.randomBytes(32).toString('hex')}`);
};

/**
 * Convert babyjubjub private ley to public key
 *
 * @param privateKey - babyjubjub private key
 * @returns public key
 */
export const privateKeyToPublicKey = (privateKey: bigint): [bigint, bigint] => {
  return eddsa.prv2pub(
    Buffer.from(ethers.BigNumber.from(privateKey).toHexString().slice(2), 'hex')
  );
};

/**
 * Generates a random babyJubJub point
 *
 * @returns random point
 */
export const genRandomPoint = (): bigint => {
  return poseidon([genRandomPrivateKey()]);
};
