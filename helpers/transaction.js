const artifacts = require('./snarkKeys');
const prover = require('./prover');

/*
Prover Inputs:

Public:
- merkleRoot
- boundParamsHash
- nullifiers
- commitmentsOut

Private:
- token
- publicSpendingKey[2]
- signature[3]
- packedIn[numIn]
- merkleTreeElements[numIn * treeDepth]
- merkleTreeIndicies[numIn]
- nullifyingKey[numIn]
- to[numOut] (master public key of recipient)
- packedOut[numOut]
*/

const dummyProof = {
  a: { x: 0n, y: 0n },
  b: { x: [0n, 0n], y: [0n, 0n] },
  c: { x: 0n, y: 0n },
};

function hashBoundParams(
  treeNumber,
  withdraw,
  adaptContract,
  adaptParams,
  
) {

}

function formatInputs(
  merkleRoot,
  boundParamsHash,
  notesIn,
  notesOut,
) {

}

async function transact(
  merkleRoot,
  boundParamsHash,
  notesIn,
  notesOut,
) {
  const artifact = artifacts.getKeys(notesIn.length, notesOut.length);

  const inputs = formatInputs(
    merkleRoot,
    boundParamsHash,
    notesIn,
    notesOut,
  );

  const proof = prover.prove(
    artifact,
    inputs,
  );

  return {
    inputs,
    proof,
  };
}

module.exports = {
  dummyProof,
  formatInputs,
  transact,
};
