#!/bin/sh
set -e

# Install Node dependencies so Capacitor SPM packages resolve correctly
cd "$CI_PRIMARY_REPOSITORY_PATH/frontend"
npm install
