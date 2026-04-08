#!/bin/sh
set -e

# Install Node.js via Homebrew (not pre-installed on Xcode Cloud)
brew install node

# Install Node dependencies so Capacitor SPM packages resolve correctly
cd "$CI_PRIMARY_REPOSITORY_PATH/frontend"
npm install
