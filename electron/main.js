const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

// Portable Linux builds cannot ship a root-owned setuid chrome-sandbox.
// Always disable the SUID sandbox on Linux (zip + AppImage).
if (process.platform === 'linux') {
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('disable-setuid-sandbox');
}

const VIDEO_EXTENSIONS = [
    'mp4', 'mov', 'm4v', 'mkv', 'avi', 'ts', 'm2ts', 'mts',
    'webm', 'h264', 'h265', 'hevc', 'yuv', 'raw', 'y4m',
];

let mainWindow = null;
let serverProcess = null;
let quitting = false;
let pendingOpenPath = null;
let rendererReady = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
}

function repoRoot() {
    return path.resolve(__dirname, '..');
}

/** Window / taskbar icon (macOS uses the .icns from the app bundle). */
function windowIconPath() {
    if (process.platform === 'darwin') return undefined;
    const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
    const bundled = path.join(__dirname, 'assets', file);
    if (fs.existsSync(bundled)) return bundled;
    const fallback = path.join(
        repoRoot(),
        'static',
        'icons',
        process.platform === 'win32' ? 'VidPlot.ico' : 'icon-512x512.png'
    );
    return fs.existsSync(fallback) ? fallback : undefined;
}

function sidecarLaunch() {
    if (app.isPackaged) {
        const dir = path.join(process.resourcesPath, 'vidplot-server');
        const command = process.platform === 'win32'
            ? path.join(dir, 'VidPlotServer.exe')
            : path.join(dir, 'VidPlotServer');
        return { command, args: [], cwd: dir };
    }
    return {
        command: firstExistingPython(),
        args: [path.join(repoRoot(), 'serve_desktop.py')],
        cwd: repoRoot(),
    };
}

function pythonCandidates() {
    const extra = [];
    if (process.env.VIDPLOT_PYTHON) extra.push(process.env.VIDPLOT_PYTHON);
    if (process.env.VIRTUAL_ENV) {
        extra.push(
            process.platform === 'win32'
                ? path.join(process.env.VIRTUAL_ENV, 'Scripts', 'python.exe')
                : path.join(process.env.VIRTUAL_ENV, 'bin', 'python')
        );
    }
    const venv = path.join(repoRoot(), 'venv');
    extra.push(
        process.platform === 'win32'
            ? path.join(venv, 'Scripts', 'python.exe')
            : path.join(venv, 'bin', 'python')
    );
    extra.push(process.platform === 'win32' ? 'python' : 'python3', 'python');
    return extra;
}

function firstExistingPython() {
    for (const candidate of pythonCandidates()) {
        if (!candidate) continue;
        if (candidate === 'python' || candidate === 'python3') return candidate;
        try {
            if (fs.existsSync(candidate)) return candidate;
        } catch {
            /* ignore */
        }
    }
    return process.platform === 'win32' ? 'python' : 'python3';
}

function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close((err) => (err ? reject(err) : resolve(port)));
        });
        server.on('error', reject);
    });
}

function waitForUrl(url, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const tryOnce = () => {
            http
                .get(url, (res) => {
                    res.resume();
                    if (res.statusCode && res.statusCode < 500) {
                        resolve();
                        return;
                    }
                    retry();
                })
                .on('error', retry);
        };
        const retry = () => {
            if (Date.now() > deadline) {
                reject(new Error('VidPlot Flask server did not start in time'));
                return;
            }
            setTimeout(tryOnce, 150);
        };
        tryOnce();
    });
}

function isVideoPath(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
    return VIDEO_EXTENSIONS.includes(ext);
}

function normalizeVideoPath(filePath) {
    if (!filePath || typeof filePath !== 'string') return null;
    let candidate = filePath.trim();
    if (!candidate || candidate.startsWith('-')) return null;
    // Windows: paths may arrive quoted
    if (
        (candidate.startsWith('"') && candidate.endsWith('"'))
        || (candidate.startsWith("'") && candidate.endsWith("'"))
    ) {
        candidate = candidate.slice(1, -1);
    }
    try {
        candidate = path.resolve(candidate);
    } catch {
        return null;
    }
    if (!isVideoPath(candidate)) return null;
    try {
        if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return null;
    } catch {
        return null;
    }
    return candidate;
}

function extractVideoPathFromArgv(argv) {
    if (!Array.isArray(argv)) return null;
    for (const arg of argv) {
        if (!arg || typeof arg !== 'string') continue;
        if (arg.startsWith('-')) continue;
        // Skip the electron/app binary and main script
        const base = path.basename(arg).toLowerCase();
        if (base === 'electron' || base === 'electron.exe') continue;
        if (base === 'vidplot' || base === 'vidplot.exe') continue;
        if (arg.includes(`${path.sep}electron${path.sep}`) && arg.endsWith('main.js')) continue;
        if (arg.endsWith(`${path.sep}main.js`) || arg.endsWith('/main.js')) continue;
        const resolved = normalizeVideoPath(arg);
        if (resolved) return resolved;
    }
    return null;
}

function focusMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

function flushOpenPath() {
    if (!pendingOpenPath || !mainWindow || mainWindow.isDestroyed()) return;
    if (!rendererReady) return;
    mainWindow.webContents.send('vidplot:open-path', pendingOpenPath);
    pendingOpenPath = null;
}

function queueOpenPathFromOs(filePath) {
    const resolved = normalizeVideoPath(filePath);
    if (!resolved) return;
    pendingOpenPath = resolved;
    flushOpenPath();
}

function startFlask(port) {
    const launch = sidecarLaunch();
    if (app.isPackaged && !fs.existsSync(launch.command)) {
        throw new Error(`Analysis server missing at ${launch.command}. Reinstall VidPlot.`);
    }
    process.stdout.write(`VidPlot server: ${launch.command}\n`);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    serverProcess = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: {
            ...env,
            VIDPLOT_DESKTOP: '1',
            VIDPLOT_PORT: String(port),
        },
        windowsHide: true,
    });

    serverProcess.on('error', (err) => {
        if (quitting) return;
        dialog.showErrorBox('VidPlot', err.message || String(err));
        app.quit();
    });

    serverProcess.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
    });
    serverProcess.stderr.on('data', (chunk) => {
        process.stderr.write(chunk);
    });
    serverProcess.on('exit', (code, signal) => {
        serverProcess = null;
        if (!quitting && code && code !== 0) {
            dialog.showErrorBox(
                'VidPlot',
                `The analysis server exited (${signal || code}). Check that Python and FFmpeg are installed.`
            );
            app.quit();
        }
    });
}

function stopFlask() {
    if (!serverProcess) return;
    const child = serverProcess;
    serverProcess = null;
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true });
        } else {
            child.kill('SIGTERM');
        }
    } catch {
        /* ignore */
    }
}

async function createWindow(url) {
    const icon = windowIconPath();
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 960,
        minHeight: 640,
        backgroundColor: '#181c24',
        title: 'VidPlot',
        ...(icon ? { icon } : {}),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    rendererReady = false;
    mainWindow.webContents.on('did-start-loading', () => {
        rendererReady = false;
    });
    mainWindow.webContents.on('did-finish-load', () => {
        // Renderer also signals ready after JS hooks are registered
        flushOpenPath();
    });

    await mainWindow.loadURL(url);
    mainWindow.on('closed', () => {
        mainWindow = null;
        rendererReady = false;
    });
}

// macOS: open-file can fire before ready
app.on('open-file', (event, filePath) => {
    event.preventDefault();
    queueOpenPathFromOs(filePath);
});

app.on('second-instance', (_event, argv) => {
    focusMainWindow();
    const fromArgv = extractVideoPathFromArgv(argv);
    if (fromArgv) queueOpenPathFromOs(fromArgv);
});

ipcMain.handle('vidplot:open-video', async () => {
    const parent = mainWindow || undefined;
    const result = await dialog.showOpenDialog(parent, {
        title: 'Choose a video to analyze',
        properties: ['openFile'],
        filters: [
            { name: 'Video Files', extensions: VIDEO_EXTENSIONS },
            { name: 'All files', extensions: ['*'] },
        ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
});

ipcMain.on('vidplot:renderer-ready', () => {
    rendererReady = true;
    flushOpenPath();
});

// Cold-start argv (Windows / Linux / `electron . /path/to/file`)
const startupPath = extractVideoPathFromArgv(process.argv);
if (startupPath) pendingOpenPath = startupPath;

if (gotSingleInstanceLock) {
    app.whenReady().then(async () => {
        if (process.platform === 'win32') {
            app.setAppUserModelId(app.isPackaged ? 'com.vidplot.app' : process.execPath);
        }
        try {
            const port = await findFreePort();
            const url = `http://127.0.0.1:${port}/`;
            startFlask(port);
            await waitForUrl(`${url}api/env`, app.isPackaged ? 60000 : 20000);
            await createWindow(url);
            flushOpenPath();
        } catch (err) {
            dialog.showErrorBox('VidPlot', err.message || String(err));
            app.quit();
        }
    });
}

app.on('before-quit', () => {
    quitting = true;
    stopFlask();
});

app.on('window-all-closed', () => {
    app.quit();
});
