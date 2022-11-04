import fs from 'fs';

if (!process.argv[2] || !process.argv[3] || !process.argv[4]) {
  console.log('Usage: node prepProposalIPFSDoc.js [output file] [proposal description markdown file] [proposal title]');
  console.log('Example: node prepProposalIPFSDoc.js ./proposalDocument.json ./proposalDescription.md "Example Proposal"');
  process.exit();
}

const markdown = fs.readFileSync(process.argv[3]);
const title = process.argv[4];

fs.writeFileSync(process.argv[2], JSON.stringify({
  title,
  description: markdown.toString(),
}));
