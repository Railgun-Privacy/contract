#!/bin/bash

# stop the existing node
lsof -ti :8545 | xargs kill
rm -f node.out

# prepare environment
export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"
[ -s "$HOME/.nvm/nvm.sh" ] && \. "$HOME/.nvm/nvm.sh"
nvm install 22
yarn install

#1. start a local node
nohup yarn run node 2>&1 > node.out &
sleep 3

#2. deploy railgun contracts
npx hardhat deploy:test --network localhost

#3. run a railgun demo
npx hardhat run scripts/demo.ts --network localhost
