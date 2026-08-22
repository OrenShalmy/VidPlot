const fs = require('fs');
const path = require('path');

/**
 * Portable Linux zips cannot install chrome-sandbox as root/setuid.
 * If the helper exists with wrong permissions, Chromium aborts before
 * --no-sandbox from main.js is enough on some hosts — remove it instead.
 */
exports.default = async function afterPack(context) {
    if (context.electronPlatformName !== 'linux') return;
    const sandbox = path.join(context.appOutDir, 'chrome-sandbox');
    try {
        if (fs.existsSync(sandbox)) {
            fs.unlinkSync(sandbox);
            console.log('afterPack: removed chrome-sandbox for portable Linux');
        }
    } catch (err) {
        console.warn('afterPack: could not remove chrome-sandbox:', err.message || err);
    }
};
