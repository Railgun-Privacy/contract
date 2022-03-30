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

async function transaction(
  merkleRoot,
  boundParamsHash,
  notesIn,
  notesOut,
) {

}

module.exports = transaction;
