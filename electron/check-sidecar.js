const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'dist', 'vidplot-server');
const exe = process.platform === 'win32' ? 'VidPlotServer.exe' : 'VidPlotServer';
const target = path.join(dir, exe);

if (!fs.existsSync(target)) {
    console.error(`Missing analysis sidecar: ${target}`);
    console.error('Build it first: python build_desktop.py');
    process.exit(1);
}
