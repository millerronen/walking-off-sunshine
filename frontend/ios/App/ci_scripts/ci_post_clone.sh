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

# cap sync overwrites Package.resolved with local node_modules references that
# don't exist in CI — restore it to the committed version (remote sources only)
git -C "$CI_PRIMARY_REPOSITORY_PATH" checkout -- frontend/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
