#!/bin/bash

if ! command -v slither &> /dev/null
then
    echo "Please install slither and run this script again"
    echo ""
    exit
fi

slither .
