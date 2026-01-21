#!/bin/bash

# Copy .env.demo to .env if .env does not exist
[ ! -f ".env" ] && cp .env.example .env
# Export all variables from .env
set -a
source .env
set +a

if [ "$USE_LOCAL_CIRCUITS" = "true" ]; then
    pushd "$CIRCUITS_V2_DIR" > /dev/null
    ./run.sh
    popd > /dev/null
fi

# prepare environment
export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"
[ -s "$HOME/.nvm/nvm.sh" ] && \. "$HOME/.nvm/nvm.sh"
nvm install 22
yarn install

#1. start anvil (local ethereum node)
# Kill any existing process on port 8545
lsof -ti :8545 | xargs kill 2>/dev/null || true
anvil > anvil.log 2>&1 &
ANVIL_PID=$!
# Auto cleanup anvil when script exits
trap "kill $ANVIL_PID 2>/dev/null" EXIT
sleep 3

#2. deploy railgun contracts
npx hardhat deploy:test --network localhost

#3. run a railgun demo
npx hardhat run scripts/demo.ts --network localhost
