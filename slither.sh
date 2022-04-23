#!/bin/bash

if ! command -v slither &> /dev/null
then
    echo "Please install slither and run this script again"
    echo ""
    exit
fi

slither .

slither-check-upgradeability . RailgunLogic
# Move original contract to legacy folder and add --new-contract-name RailgunLogicV2 when writing proxy upgrade
