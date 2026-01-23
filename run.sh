#!/bin/bash

# Copy .env.demo to .env if .env does not exist
[ ! -f ".env" ] && cp .env.example .env
# Export all variables from .env
set -a
source .env
set +a

# Auto-install rapidsnark if USE_RAPIDSNARK=true and not installed
if [ "$USE_RAPIDSNARK" = "true" ]; then
    if [ ! -x "/usr/local/bin/rapidsnark" ]; then
        echo "⚡ USE_RAPIDSNARK=true but rapidsnark not found, installing..."
        ./install_rapidsnark.sh
    else
        echo "⚡ rapidsnark already installed: /usr/local/bin/rapidsnark"
    fi
fi

if [ "$USE_LOCAL_CIRCUITS" = "true" ]; then
    pushd "$CIRCUITS_V2_DIR" > /dev/null
    ./run.sh
    popd > /dev/null
fi

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
