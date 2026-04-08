#!/bin/sh
set -e

# Install Node.js via Homebrew (not pre-installed on Xcode Cloud)
brew install node

# Install Node dependencies and sync Capacitor so iOS project gets config files
cd "$CI_PRIMARY_REPOSITORY_PATH/frontend"
npm install
npx cap sync ios
