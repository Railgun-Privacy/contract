/* global describe it beforeEach overwriteArtifact ethers */
const { expect } = require('chai');

const poseidonGenContract = require('circomlib/src/poseidon_gencontract');
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

let railgunLogic;
let testERC20;

describe('Logic/RailgunLogic', () => {
  beforeEach(async () => {
    // Deploy test token
    const TestERC20 = await ethers.getContractFactory('TestERC20');
    testERC20 = await TestERC20.deploy();

    // Deploy Poseidon library
    await overwriteArtifact(
      'PoseidonT3',
      poseidonGenContract.createCode(2),
    );

    await overwriteArtifact(
      'PoseidonT6',
      poseidonGenContract.createCode(5),
    );

    const PoseidonT3 = await ethers.getContractFactory('PoseidonT3');
    const poseidonT3 = await PoseidonT3.deploy();
    const PoseidonT6 = await ethers.getContractFactory('PoseidonT6');
    const poseidonT6 = await PoseidonT6.deploy();

    // Deploy Railgun Logic
    const RailgunLogic = await ethers.getContractFactory('RailgunLogic', {
      libraries: {
        PoseidonT3: poseidonT3.address,
        PoseidonT6: poseidonT6.address,
      },
    });

    railgunLogic = await RailgunLogic.deploy();

    await railgunLogic.initializeRailgunLogic(
      verificationKey.vKeySmall,
      verificationKey.vKeyLarge,
      [testERC20.address],
      (await ethers.getSigners())[1].address,
      0n,
      0n,
      0n,
      (await ethers.getSigners())[0].address,
      { gasLimit: 2000000 },
    );
  });

  it('Should verify proofs', async () => {
    const merkleTree = new MerkleTree();

    const outputNote = Note.generateNote(railgunAccount.publicKey, 100n, testERC20.address);

    const proof = await prover.generateProof({
      merkleTree,
      depositAmount: 100n,
      outputs: [
        outputNote,
      ],
    });

    expect(await prover.verifyProof(proof)).to.equal(true);

    const txResult = await railgunLogic.verifyProof(
      // Proof
      proof.proof.solidity,
      // Shared
      proof.publicInputs.adaptID.address,
      proof.publicInputs.adaptID.parameters,
      proof.publicInputs.depositAmount,
      proof.publicInputs.withdrawAmount,
      proof.publicInputs.outputTokenField,
      proof.publicInputs.outputEthAddress,
      // Join
      proof.publicInputs.treeNumber,
      proof.publicInputs.merkleRoot,
      proof.publicInputs.nullifiers,
      // Split
      proof.publicInputs.commitments,
    );

    expect(txResult).to.equal(true);
  });

  it('Should deposit token correctly', async () => {
    const merkleTree = new MerkleTree();

    const outputNote = Note.generateNote(railgunAccount.publicKey, 100n, testERC20.address);

    const proof = await prover.generateProof({
      merkleTree,
      depositAmount: 100n,
      outputs: [
        outputNote,
      ],
    });

    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);

    expect(await prover.verifyProof(proof)).to.equal(true);

    await railgunLogic.transact(
      // Proof
      proof.proof.solidity,
      // Shared
      proof.publicInputs.adaptID.address,
      proof.publicInputs.adaptID.parameters,
      proof.publicInputs.depositAmount,
      proof.publicInputs.withdrawAmount,
      proof.publicInputs.outputTokenField,
      proof.publicInputs.outputEthAddress,
      // Join
      proof.publicInputs.treeNumber,
      proof.publicInputs.merkleRoot,
      proof.publicInputs.nullifiers,
      // Split
      proof.publicInputs.commitments,
      {
        value: 1000000n,
        gasLimit: 1500000,
      },
    );

    merkleTree.insertLeaves(proof.publicInputs.commitments.map((commitment) => commitment.hash));

    expect(
      (await railgunLogic.merkleRoot()),
    ).to.equal(
      merkleTree.root,
    );
  });

  it('Should collect treasury fees correctly', async () => {
    await railgunLogic.changeFee(2500n, 2500n, 1000000n);

    const merkleTree = new MerkleTree();

    const note = Note.generateNote(railgunAccount.publicKey, 100n, testERC20.address);

    const initialTreasuryBalance = await ethers.provider.getBalance(
      (await ethers.getSigners())[1].address,
    );

    const proof = await prover.generateProof({
      merkleTree,
      depositAmount: 100n,
      outputs: [
        note,
      ],
    });

    merkleTree.insertLeaves(proof.publicInputs.commitments.map((commitment) => commitment.hash));

    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);

    expect(await prover.verifyProof(proof)).to.equal(true);

    await railgunLogic.transact(
      // Proof
      proof.proof.solidity,
      // Shared
      proof.publicInputs.adaptID.address,
      proof.publicInputs.adaptID.parameters,
      proof.publicInputs.depositAmount,
      proof.publicInputs.withdrawAmount,
      proof.publicInputs.outputTokenField,
      proof.publicInputs.outputEthAddress,
      // Join
      proof.publicInputs.treeNumber,
      proof.publicInputs.merkleRoot,
      proof.publicInputs.nullifiers,
      // Split
      proof.publicInputs.commitments,
      {
        value: 1000000n,
        gasLimit: 1500000,
      },
    );

    const newTreasuryBalance = await ethers.provider.getBalance(
      (await ethers.getSigners())[1].address,
    );

    expect(BigInt(newTreasuryBalance) - BigInt(initialTreasuryBalance)).to.equal(1000000n);

    expect(
      await testERC20.balanceOf((await ethers.getSigners())[1].address),
    ).to.equal(25n);

    const proof2 = await prover.generateProof({
      merkleTree,
      withdrawAmount: 100n,
      outputEthAddress: (await ethers.getSigners())[0].address,
      spendingKeys: [
        railgunAccount.privateKey,
      ],
      notes: [
        note,
      ],
    });

    await railgunLogic.transact(
      // Proof
      proof2.proof.solidity,
      // Shared
      proof2.publicInputs.adaptID.address,
      proof2.publicInputs.adaptID.parameters,
      proof2.publicInputs.depositAmount,
      proof2.publicInputs.withdrawAmount,
      proof2.publicInputs.outputTokenField,
      proof2.publicInputs.outputEthAddress,
      // Join
      proof2.publicInputs.treeNumber,
      proof2.publicInputs.merkleRoot,
      proof2.publicInputs.nullifiers,
      // Split
      proof2.publicInputs.commitments,
      {
        value: 1000000n,
        gasLimit: 1500000,
      },
    );

    expect(
      await testERC20.balanceOf((await ethers.getSigners())[1].address),
    ).to.equal(50n);
  });

  it('Should deposit with 2 outputs correctly', async () => {
    const merkleTree = new MerkleTree();

    const outputNote = Note.generateNote(railgunAccount.publicKey, 30n, testERC20.address);
    const outputNote2 = Note.generateNote(railgunAccount.publicKey, 70n, testERC20.address);

    const proof = await prover.generateProof({
      merkleTree,
      depositAmount: 100n,
      outputs: [
        outputNote,
        outputNote2,
      ],
    });

    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);

    expect(await prover.verifyProof(proof)).to.equal(true);

    await railgunLogic.transact(
      // Proof
      proof.proof.solidity,
      // Shared
      proof.publicInputs.adaptID.address,
      proof.publicInputs.adaptID.parameters,
      proof.publicInputs.depositAmount,
      proof.publicInputs.withdrawAmount,
      proof.publicInputs.outputTokenField,
      proof.publicInputs.outputEthAddress,
      // Join
      proof.publicInputs.treeNumber,
      proof.publicInputs.merkleRoot,
      proof.publicInputs.nullifiers,
      // Split
      proof.publicInputs.commitments,
      {
        value: 1000000n,
        gasLimit: 1500000,
      },
    );

    merkleTree.insertLeaves(proof.publicInputs.commitments.map((commitment) => commitment.hash));

    expect(
      (await railgunLogic.merkleRoot()),
    ).to.equal(
      merkleTree.root,
    );
  });

  it('Should deposit with 3 outputs correctly', async () => {
    const merkleTree = new MerkleTree();

    const outputNote = Note.generateNote(railgunAccount.publicKey, 40n, testERC20.address);
    const outputNote2 = Note.generateNote(railgunAccount.publicKey, 120n, testERC20.address);
    const outputNote3 = Note.generateNote(railgunAccount.publicKey, 80n, testERC20.address);

    const proof = await prover.generateProof({
      merkleTree,
      depositAmount: 240n,
      outputs: [
        outputNote,
        outputNote2,
        outputNote3,
      ],
    });

    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);

    expect(await prover.verifyProof(proof)).to.equal(true);

    await railgunLogic.transact(
      // Proof
      proof.proof.solidity,
      // Shared
      proof.publicInputs.adaptID.address,
      proof.publicInputs.adaptID.parameters,
      proof.publicInputs.depositAmount,
      proof.publicInputs.withdrawAmount,
      proof.publicInputs.outputTokenField,
      proof.publicInputs.outputEthAddress,
      // Join
      proof.publicInputs.treeNumber,
      proof.publicInputs.merkleRoot,
      proof.publicInputs.nullifiers,
      // Split
      proof.publicInputs.commitments,
      {
        value: 1000000n,
        gasLimit: 1500000,
      },
    );

    merkleTree.insertLeaves(proof.publicInputs.commitments.map((commitment) => commitment.hash));

    expect(
      (await railgunLogic.merkleRoot()),
    ).to.equal(
      merkleTree.root,
    );
  });

  it('Should deposit and withdraw', async () => {
    const merkleTree = new MerkleTree();

    const outputNote = Note.generateNote(railgunAccount.publicKey, 100n, testERC20.address);

    const initialtestERC20Balance = await testERC20.balanceOf(
      (await ethers.getSigners())[0].address,
    );

    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);

    const proof = await prover.generateProof({
      merkleTree,
      depositAmount: 100n,
      outputs: [
        outputNote,
      ],
    });

    expect(await prover.verifyProof(proof)).to.equal(true);

    await railgunLogic.transact(
      // Proof
      proof.proof.solidity,
      // Shared
      proof.publicInputs.adaptID.address,
      proof.publicInputs.adaptID.parameters,
      proof.publicInputs.depositAmount,
      proof.publicInputs.withdrawAmount,
      proof.publicInputs.outputTokenField,
      proof.publicInputs.outputEthAddress,
      // Join
      proof.publicInputs.treeNumber,
      proof.publicInputs.merkleRoot,
      proof.publicInputs.nullifiers,
      // Split
      proof.publicInputs.commitments,
      {
        value: 1000000n,
        gasLimit: 1500000,
      },
    );

    merkleTree.insertLeaves(proof.publicInputs.commitments.map((commitment) => commitment.hash));

    expect(
      (await railgunLogic.merkleRoot()),
    ).to.equal(
      merkleTree.root,
    );

    const proof2 = await prover.generateProof({
      merkleTree,
      notes: [
        outputNote,
      ],
      spendingKeys: [
        railgunAccount.privateKey,
      ],
      withdrawAmount: 100n,
      outputEthAddress: (await ethers.getSigners())[0].address,
    });

    expect(await prover.verifyProof(proof2)).to.equal(true);

    await railgunLogic.transact(
      // Proof
      proof2.proof.solidity,
      // Shared
      proof2.publicInputs.adaptID.address,
      proof2.publicInputs.adaptID.parameters,
      proof2.publicInputs.depositAmount,
      proof2.publicInputs.withdrawAmount,
      proof2.publicInputs.outputTokenField,
      proof2.publicInputs.outputEthAddress,
      // Join
      proof2.publicInputs.treeNumber,
      proof2.publicInputs.merkleRoot,
      proof2.publicInputs.nullifiers,
      // Split
      proof2.publicInputs.commitments,
      {
        value: 1000000n,
        gasLimit: 1500000,
      },
    );

    merkleTree.insertLeaves(proof2.publicInputs.commitments.map((commitment) => commitment.hash));

    expect(
      (await railgunLogic.merkleRoot()),
    ).to.equal(
      merkleTree.root,
    );

    expect(await testERC20.balanceOf((await ethers.getSigners())[0].address))
      .to.equal(initialtestERC20Balance);
  });

  it('Should deposit, do an internal transaction, and withdraw', async () => {
    const merkleTree = new MerkleTree();

    const outputNote1a = Note.generateNote(railgunAccount.publicKey, 100n, testERC20.address);
    const outputNote1b = Note.generateNote(railgunAccount.publicKey, 50n, testERC20.address);

    const initialtestERC20Balance = await testERC20.balanceOf(
      (await ethers.getSigners())[0].address,
    );

    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);

    const proof = await prover.generateProof({
      merkleTree,
      depositAmount: 150n,
      outputs: [
        outputNote1a,
        outputNote1b,
      ],
    });

    expect(await prover.verifyProof(proof)).to.equal(true);

    await railgunLogic.transact(
      // Proof
      proof.proof.solidity,
      // Shared
      proof.publicInputs.adaptID.address,
      proof.publicInputs.adaptID.parameters,
      proof.publicInputs.depositAmount,
      proof.publicInputs.withdrawAmount,
      proof.publicInputs.outputTokenField,
      proof.publicInputs.outputEthAddress,
      // Join
      proof.publicInputs.treeNumber,
      proof.publicInputs.merkleRoot,
      proof.publicInputs.nullifiers,
      // Split
      proof.publicInputs.commitments,
      {
        value: 1000000n,
        gasLimit: 1500000,
      },
    );

    merkleTree.insertLeaves(proof.publicInputs.commitments.map((commitment) => commitment.hash));

    expect(
      (await railgunLogic.merkleRoot()),
    ).to.equal(
      merkleTree.root,
    );

    const outputNote2a = Note.generateNote(railgunAccount.publicKey, 70n, testERC20.address);
    const outputNote2b = Note.generateNote(railgunAccount.publicKey, 80n, testERC20.address);

    const proof2 = await prover.generateProof({
      merkleTree,
      notes: [
        outputNote1a,
        outputNote1b,
      ],
      spendingKeys: [
        railgunAccount.privateKey,
        railgunAccount.privateKey,
      ],
      outputs: [
        outputNote2a,
        outputNote2b,
      ],
    });

    expect(await prover.verifyProof(proof2)).to.equal(true);

    await railgunLogic.transact(
      // Proof
      proof2.proof.solidity,
      // Shared
      proof2.publicInputs.adaptID.address,
      proof2.publicInputs.adaptID.parameters,
      proof2.publicInputs.depositAmount,
      proof2.publicInputs.withdrawAmount,
      proof2.publicInputs.outputTokenField,
      proof2.publicInputs.outputEthAddress,
      // Join
      proof2.publicInputs.treeNumber,
      proof2.publicInputs.merkleRoot,
      proof2.publicInputs.nullifiers,
      // Split
      proof2.publicInputs.commitments,
      {
        value: 1000000n,
        gasLimit: 1500000,
      },
    );

    merkleTree.insertLeaves(proof2.publicInputs.commitments.map((commitment) => commitment.hash));

    expect(
      (await railgunLogic.merkleRoot()),
    ).to.equal(
      merkleTree.root,
    );

    const proof3 = await prover.generateProof({
      merkleTree,
      notes: [
        outputNote2a,
        outputNote2b,
      ],
      spendingKeys: [
        railgunAccount.privateKey,
        railgunAccount.privateKey,
      ],
      withdrawAmount: 150n,
      outputEthAddress: (await ethers.getSigners())[0].address,
    });

    expect(await prover.verifyProof(proof3)).to.equal(true);

    await railgunLogic.transact(
      // Proof
      proof3.proof.solidity,
      // Shared
      proof3.publicInputs.adaptID.address,
      proof3.publicInputs.adaptID.parameters,
      proof3.publicInputs.depositAmount,
      proof3.publicInputs.withdrawAmount,
      proof3.publicInputs.outputTokenField,
      proof3.publicInputs.outputEthAddress,
      // Join
      proof2.publicInputs.treeNumber,
      proof3.publicInputs.merkleRoot,
      proof3.publicInputs.nullifiers,
      // Split
      proof3.publicInputs.commitments,
      {
        value: 1000000n,
        gasLimit: 1500000,
      },
    );

    merkleTree.insertLeaves(proof3.publicInputs.commitments.map((commitment) => commitment.hash));

    expect(
      (await railgunLogic.merkleRoot()),
    ).to.equal(
      merkleTree.root,
    );

    expect(await testERC20.balanceOf((await ethers.getSigners())[0].address))
      .to.equal(initialtestERC20Balance);
  });

  it('Should transact with large circuit', async () => {
    const merkleTree = new MerkleTree();

    const outputNote1a = Note.generateNote(railgunAccount.publicKey, 100n, testERC20.address);
    const outputNote1b = Note.generateNote(railgunAccount.publicKey, 50n, testERC20.address);

    const initialtestERC20Balance = await testERC20.balanceOf(
      (await ethers.getSigners())[0].address,
    );

    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);

    const proof = await prover.generateProof({
      merkleTree,
      depositAmount: 150n,
      outputs: [
        outputNote1a,
        outputNote1b,
      ],
    }, true);

    expect(await prover.verifyProof(proof, true)).to.equal(true);

    await railgunLogic.transact(
      // Proof
      proof.proof.solidity,
      // Shared
      proof.publicInputs.adaptID.address,
      proof.publicInputs.adaptID.parameters,
      proof.publicInputs.depositAmount,
      proof.publicInputs.withdrawAmount,
      proof.publicInputs.outputTokenField,
      proof.publicInputs.outputEthAddress,
      // Join
      proof.publicInputs.treeNumber,
      proof.publicInputs.merkleRoot,
      proof.publicInputs.nullifiers,
      // Split
      proof.publicInputs.commitments,
      {
        value: 1000000n,
        gasLimit: 12000000,
      },
    );

    merkleTree.insertLeaves(proof.publicInputs.commitments.map((commitment) => commitment.hash));

    expect(
      (await railgunLogic.merkleRoot()),
    ).to.equal(
      merkleTree.root,
    );

    const outputNote2a = Note.generateNote(railgunAccount.publicKey, 70n, testERC20.address);
    const outputNote2b = Note.generateNote(railgunAccount.publicKey, 80n, testERC20.address);

    const proof2 = await prover.generateProof({
      merkleTree,
      notes: [
        outputNote1a,
        outputNote1b,
      ],
      spendingKeys: [
        railgunAccount.privateKey,
        railgunAccount.privateKey,
      ],
      outputs: [
        outputNote2a,
        outputNote2b,
      ],
    }, true);

    expect(await prover.verifyProof(proof2, true)).to.equal(true);

    await railgunLogic.transact(
      // Proof
      proof2.proof.solidity,
      // Shared
      proof2.publicInputs.adaptID.address,
      proof2.publicInputs.adaptID.parameters,
      proof2.publicInputs.depositAmount,
      proof2.publicInputs.withdrawAmount,
      proof2.publicInputs.outputTokenField,
      proof2.publicInputs.outputEthAddress,
      // Join
      proof2.publicInputs.treeNumber,
      proof2.publicInputs.merkleRoot,
      proof2.publicInputs.nullifiers,
      // Split
      proof2.publicInputs.commitments,
      {
        value: 1000000n,
        gasLimit: 12000000,
      },
    );

    merkleTree.insertLeaves(proof2.publicInputs.commitments.map((commitment) => commitment.hash));

    expect(
      (await railgunLogic.merkleRoot()),
    ).to.equal(
      merkleTree.root,
    );

    const proof3 = await prover.generateProof({
      merkleTree,
      notes: [
        outputNote2a,
        outputNote2b,
      ],
      spendingKeys: [
        railgunAccount.privateKey,
        railgunAccount.privateKey,
      ],
      withdrawAmount: 150n,
      outputEthAddress: (await ethers.getSigners())[0].address,
    }, true);

    expect(await prover.verifyProof(proof3, true)).to.equal(true);

    await railgunLogic.transact(
      // Proof
      proof3.proof.solidity,
      // Shared
      proof3.publicInputs.adaptID.address,
      proof3.publicInputs.adaptID.parameters,
      proof3.publicInputs.depositAmount,
      proof3.publicInputs.withdrawAmount,
      proof3.publicInputs.outputTokenField,
      proof3.publicInputs.outputEthAddress,
      // Join
      proof2.publicInputs.treeNumber,
      proof3.publicInputs.merkleRoot,
      proof3.publicInputs.nullifiers,
      // Split
      proof3.publicInputs.commitments,
      {
        value: 1000000n,
        gasLimit: 12000000,
      },
    );

    merkleTree.insertLeaves(proof3.publicInputs.commitments.map((commitment) => commitment.hash));

    expect(
      (await railgunLogic.merkleRoot()),
    ).to.equal(
      merkleTree.root,
    );

    expect(await testERC20.balanceOf((await ethers.getSigners())[0].address))
      .to.equal(initialtestERC20Balance);
  });

  it('Should deposit and generate commitments correctly', async () => {
    const merkleTree = new MerkleTree();

    const note = Note.generateNote(railgunAccount.publicKey, 10000n, testERC20.address);

    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);

    const initialBalance = await testERC20.balanceOf(
      (await ethers.getSigners())[0].address,
    );

    await railgunLogic.generateDeposit(
      utils.unpackPoint(railgunAccount.publicKey),
      note.random,
      note.amount,
      utils.bigInt2ETHAddress(note.token),
      {
        gasLimit: 1500000,
      },
    );

    const newBalance = await testERC20.balanceOf(
      (await ethers.getSigners())[0].address,
    );

    expect(BigInt(initialBalance) - BigInt(newBalance)).to.equal(note.amount);

    merkleTree.insertLeaves([note.hash]);

    expect(
      (await railgunLogic.merkleRoot()),
    ).to.equal(
      merkleTree.root,
    );
  });

  it('Should be able to spend from generated commitment', async () => {
    const merkleTree = new MerkleTree();

    const note = Note.generateNote(railgunAccount.publicKey, 10000n, testERC20.address);

    await testERC20.approve(railgunLogic.address, 2n ** 256n - 1n);

    const initialBalance = await testERC20.balanceOf(
      (await ethers.getSigners())[0].address,
    );

    await railgunLogic.generateDeposit(
      utils.unpackPoint(railgunAccount.publicKey),
      note.random,
      note.amount,
      utils.bigInt2ETHAddress(note.token),
      {
        gasLimit: 1500000,
      },
    );

    const newBalance = await testERC20.balanceOf(
      (await ethers.getSigners())[0].address,
    );

    expect(BigInt(initialBalance) - BigInt(newBalance)).to.equal(note.amount);

    merkleTree.insertLeaves([note.hash]);

    expect(
      (await railgunLogic.merkleRoot()),
    ).to.equal(
      merkleTree.root,
    );

    const proof = await prover.generateProof({
      merkleTree,
      notes: [
        note,
      ],
      spendingKeys: [
        railgunAccount.privateKey,
      ],
      withdrawAmount: note.amount,
      outputEthAddress: (await ethers.getSigners())[0].address,
    });

    expect(await prover.verifyProof(proof)).to.equal(true);

    await railgunLogic.transact(
      // Proof
      proof.proof.solidity,
      // Shared
      proof.publicInputs.adaptID.address,
      proof.publicInputs.adaptID.parameters,
      proof.publicInputs.depositAmount,
      proof.publicInputs.withdrawAmount,
      proof.publicInputs.outputTokenField,
      proof.publicInputs.outputEthAddress,
      // Join
      proof.publicInputs.treeNumber,
      proof.publicInputs.merkleRoot,
      proof.publicInputs.nullifiers,
      // Split
      proof.publicInputs.commitments,
      {
        value: 1000000n,
        gasLimit: 1500000,
      },
    );

    merkleTree.insertLeaves(proof.publicInputs.commitments.map((commitment) => commitment.hash));

    expect(
      (await railgunLogic.merkleRoot()),
    ).to.equal(
      merkleTree.root,
    );

    expect(await testERC20.balanceOf((await ethers.getSigners())[0].address))
      .to.equal(initialBalance);
  });
});
