/**
 * Fallback Electron binary download when electron/install.js leaves path.txt missing.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { downloadArtifact } = require('@electron/get');
const extract = require('extract-zip');

function electronDir() {
    return path.join(__dirname, '..', 'node_modules', 'electron');
}

function platformPath() {
    switch (process.platform) {
        case 'darwin':
            return 'Electron.app/Contents/MacOS/Electron';
        case 'win32':
            return 'electron.exe';
        default:
            return 'electron';
    }
}

async function main() {
    const root = electronDir();
    const { version } = require(path.join(root, 'package.json'));
    let arch = process.arch;

    if (process.platform === 'darwin' && arch === 'x64') {
        try {
            const out = spawnSync('sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf-8' });
            if (out.stdout.trim() === '1') arch = 'arm64';
        } catch {
            /* ignore */
        }
    }

    const zip = await downloadArtifact({
        version,
        artifactName: 'electron',
        platform: process.platform,
        arch,
    });

    const dest = path.join(root, 'dist');
    fs.mkdirSync(dest, { recursive: true });

    if (process.platform === 'win32') {
        await extract(zip, { dir: dest });
    } else {
        const unzip = spawnSync('unzip', ['-o', zip, '-d', dest], { stdio: 'inherit' });
        if (unzip.status !== 0) {
            await extract(zip, { dir: dest });
        }
    }

    fs.writeFileSync(path.join(root, 'path.txt'), platformPath());
    console.log('Electron binary ready:', path.join(dest, platformPath()));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
