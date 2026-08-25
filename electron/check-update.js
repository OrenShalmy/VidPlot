const https = require('https');

const RELEASES_API = 'https://api.github.com/repos/OrenShalmy/VidPlot/releases/latest';
const RELEASES_PAGE = 'https://github.com/OrenShalmy/VidPlot/releases/latest';

function parseVersion(value) {
    const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a, b) {
    const left = parseVersion(a);
    const right = parseVersion(b);
    if (!left || !right) return 0;
    for (let i = 0; i < 3; i += 1) {
        if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0;
}

function fetchJson(url, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const req = https.get(
            url,
            {
                headers: {
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'VidPlot-Desktop-Update-Check',
                },
            },
            (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 301 || res.statusCode === 302) {
                        const next = res.headers.location;
                        if (next) {
                            fetchJson(next, timeoutMs).then(resolve).catch(reject);
                            return;
                        }
                    }
                    if (res.statusCode !== 200) {
                        reject(new Error(`GitHub API returned ${res.statusCode}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(body));
                    } catch (err) {
                        reject(err);
                    }
                });
            }
        );
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('Update check timed out'));
        });
    });
}

function preferredAssetName(platform, arch) {
    if (platform === 'darwin') {
        if (arch === 'arm64') return 'VidPlot-MacOS-arm64.zip';
        return 'VidPlot-MacOS-x64.zip';
    }
    if (platform === 'win32') {
        const suffix = arch === 'arm64' ? 'arm64' : 'x64';
        return `VidPlot-Windows-${suffix}-Setup.exe`;
    }
    if (platform === 'linux') {
        const suffix = arch === 'arm64' ? 'arm64' : 'x64';
        return `VidPlot-Linux-${suffix}.AppImage`;
    }
    return null;
}

function pickDownloadAsset(release, platform, arch) {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const preferred = preferredAssetName(platform, arch);
    if (preferred) {
        const exact = assets.find((asset) => asset.name === preferred);
        if (exact?.browser_download_url) {
            return { name: exact.name, url: exact.browser_download_url };
        }
    }
    const fallback = assets.find((asset) => /\.(zip|exe|AppImage)$/i.test(asset.name || ''));
    if (fallback?.browser_download_url) {
        return { name: fallback.name, url: fallback.browser_download_url };
    }
    return { name: '', url: release?.html_url || RELEASES_PAGE };
}

async function checkForUpdate(currentVersion, platform = process.platform, arch = process.arch) {
    const current = String(currentVersion || '').trim();
    let release;
    try {
        release = await fetchJson(RELEASES_API);
    } catch (err) {
        return {
            ok: false,
            error: err.message || 'Could not reach GitHub',
            currentVersion: current,
            releasesUrl: RELEASES_PAGE,
        };
    }

    const tag = String(release.tag_name || '').trim();
    const latestVersion = tag.replace(/^v/i, '') || tag;
    const asset = pickDownloadAsset(release, platform, arch);
    const updateAvailable = compareVersions(latestVersion, current) > 0;

    return {
        ok: true,
        currentVersion: current,
        latestVersion,
        latestTag: tag,
        updateAvailable,
        releaseName: release.name || tag,
        releaseNotes: release.body || '',
        releasesUrl: release.html_url || RELEASES_PAGE,
        downloadUrl: asset.url,
        downloadName: asset.name,
    };
}

module.exports = {
    RELEASES_PAGE,
    compareVersions,
    checkForUpdate,
};
