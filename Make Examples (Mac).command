#!/bin/bash
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund
npm run examples
echo
read -n 1 -s -r -p "Press any key to close"
