/**
 * Root postinstall script.
 * 
 * NOTE: We intentionally do NOT run electron-builder install-app-deps here.
 * With pnpm workspaces, electron-builder install-app-deps corrupts the shared
 * node_modules by running pnpm install --production in release/app.
 * 
 * Native module rebuilding is handled by:
 * 1. release/app/postinstall runs electron-rebuild for native deps in release/app
 * 2. The build process handles the rest
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// Run native dependency check
try {
    require('./check-native-dep.cjs')
} catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
        console.log('Native dependency check skipped: module not found')
    } else {
        throw e
    }
}

console.log('Postinstall complete (skipping electron-builder install-app-deps for pnpm compatibility)')

try {
    execSync('node scripts/workspace-guard.mjs --record-install-state', {
        stdio: 'inherit',
    })
} catch (error) {
    console.error('Workspace install state recording failed')
    throw error
}
