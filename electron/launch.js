#!/usr/bin/env node
/**
 * Start Electron without Cursor/VS Code Electron env vars.
 * Those leak into the integrated terminal and break preload / native dialogs.
 */
const { spawn } = require('child_process');
const path = require('path');
const { ensureElectron } = require('./ensure-electron');

if (!ensureElectron()) {
    process.exit(1);
}

const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ASAR;
delete env.ELECTRON_NO_ATTACH_CONSOLE;
delete env.VSCODE_INSPECTOR_OPTIONS;

const child = spawn(electron, [path.join(__dirname, '..'), ...process.argv.slice(2)], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: 'inherit',
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code == null ? 1 : code);
});
