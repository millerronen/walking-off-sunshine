#!/bin/sh
set -e

# Install Node.js via Homebrew (not pre-installed on Xcode Cloud)
brew install node

# Install Node dependencies and sync Capacitor so iOS project gets config files
cd "$CI_PRIMARY_REPOSITORY_PATH/frontend"
npm install

# Build web assets (required by cap sync) using a placeholder API key
VITE_GOOGLE_MAPS_API_KEY=placeholder npm run build

npx cap sync ios
