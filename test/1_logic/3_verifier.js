/* global describe it beforeEach ethers */
const { expect } = require('chai');
const {
  MerkleTree, Note, prover, utils,
} = require('railgun-privacy.js');
const verificationKey = require('../../verificationKey');

const privateKey = utils.genRandomPrivateKey();
const publicKey = utils.genPublicKey(privateKey);
const railgunAccount = {
  privateKey: utils.bigInt2Buffer(privateKey),
  publicKey: utils.packPoint(publicKey),
};

let verifier;
let testERC20;

describe('Logic/Verifier', () => {
  beforeEach(async () => {
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    testERC20 = await TestERC20.deploy();
    // Deploy Verifier Logic
    const Verifier = await ethers.getContractFactory('VerifierStub');

    verifier = await Verifier.deploy();
    await verifier.initializeVerifierStub(
      verificationKey.vKeySmall,
      verificationKey.vKeyLarge,
    );
  });

  it('Should hash cipher text', async () => {
    const merkleTree = new MerkleTree();
    const outputNote = Note.generateNote(railgunAccount.publicKey, 100n, testERC20.address);

    const proof = await prover.generateProof({
      merkleTree,
      depositAmount: 100n,
      outputs: [
        outputNote,
      ],
    });

    const txResult = String(await verifier.hashCipherTextStub(proof.publicInputs.commitments));
    const txResult2 = String(await verifier.hashCipherTextStub(proof.publicInputs.commitments));
    expect(txResult).to.equal(txResult2);
  });

  it('Should hash inputs', async () => {
    const merkleTree = new MerkleTree();
    const outputNote = Note.generateNote(railgunAccount.publicKey, 100n, testERC20.address);

    const proof = await prover.generateProof({
      merkleTree,
      depositAmount: 100n,
      outputs: [
        outputNote,
      ],
    });

    const txResult = String(await verifier.inputsHashPreStub(
      proof.publicInputs.adaptID.address,
      proof.publicInputs.adaptID.parameters,
      proof.publicInputs.depositAmount,
      proof.publicInputs.withdrawAmount,
      proof.publicInputs.outputTokenField,
      proof.publicInputs.outputEthAddress,
      proof.publicInputs.treeNumber,
      proof.publicInputs.merkleRoot,
      proof.publicInputs.nullifiers,
      proof.publicInputs.commitments,
    ));

    const txResult2 = String(await verifier.inputsHashPreStub(
      proof.publicInputs.adaptID.address,
      proof.publicInputs.adaptID.parameters,
      proof.publicInputs.depositAmount,
      proof.publicInputs.withdrawAmount,
      proof.publicInputs.outputTokenField,
      proof.publicInputs.outputEthAddress,
      proof.publicInputs.treeNumber,
      proof.publicInputs.merkleRoot,
      proof.publicInputs.nullifiers,
      proof.publicInputs.commitments,
    ));

    expect(txResult).to.equal(txResult2);
  });
});
