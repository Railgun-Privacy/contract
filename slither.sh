#!/bin/bash

if ! command -v slither &> /dev/null
then
    echo "Please install slither and run this script again"
    echo ""
    exit
fi

rm report.md

slither --exclude-dependencies --checklist . > report.md

# Move original contract to legacy folder and add eg --new-contract-name RailgunLogic when writing proxy upgrade
slither-check-upgradeability --proxy-name PausableUpgradableProxy . RailgunLogic
slither-check-upgradeability --proxy-name PausableUpgradableProxy . GovernorRewards
slither-check-upgradeability --proxy-name PausableUpgradableProxy . Treasury
