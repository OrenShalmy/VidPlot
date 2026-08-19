const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function electronDir() {
    return path.join(__dirname, '..', 'node_modules', 'electron');
}

function electronBinaryPath() {
    const root = electronDir();
    const pathFile = path.join(root, 'path.txt');
    if (!fs.existsSync(pathFile)) return null;
    const rel = fs.readFileSync(pathFile, 'utf-8').trim();
    if (!rel) return null;
    const exe = path.join(root, 'dist', rel);
    return fs.existsSync(exe) ? exe : null;
}

function runElectronInstall() {
    const install = path.join(electronDir(), 'install.js');
    if (!fs.existsSync(install)) {
        console.error('electron package missing; run npm install');
        return false;
    }
    console.log('Downloading Electron binary (first run or after npm ci)...');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
    const result = spawnSync(process.execPath, [install], {
        cwd: path.join(__dirname, '..'),
        env,
        stdio: 'inherit',
    });
    return result.status === 0;
}

function runFetchFallback() {
    const fetch = path.join(__dirname, 'fetch-binary.js');
    const result = spawnSync(process.execPath, [fetch], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
    });
    return result.status === 0;
}

function ensureElectron() {
    if (electronBinaryPath()) return true;
    runElectronInstall();
    if (electronBinaryPath()) return true;
    runFetchFallback();
    if (electronBinaryPath()) return true;

    console.error(
        'Electron binary still missing after install.\n' +
            'Try:\n' +
            '  npm install-scripts approve electron\n' +
            '  rm -rf node_modules/electron\n' +
            '  npm install'
    );
    return false;
}

module.exports = { electronBinaryPath, ensureElectron };

if (require.main === module) {
    process.exit(ensureElectron() ? 0 : 1);
}
