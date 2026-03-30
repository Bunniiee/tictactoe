#!/bin/bash
# Build the Nakama TypeScript modules
cd backend
npm install
npm run build
echo "Build complete. JS modules are in backend/data/modules/"
