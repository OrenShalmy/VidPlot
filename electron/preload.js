const { contextBridge, ipcRenderer, webUtils } = require('electron');
const pkg = require('../package.json');

contextBridge.exposeInMainWorld('vidplotDesktop', {
    isDesktop: true,
    version: pkg.version,
    openVideo: () => ipcRenderer.invoke('vidplot:open-video'),
    checkForUpdate: () => ipcRenderer.invoke('vidplot:check-update'),
    offerUpdate: (info) => ipcRenderer.invoke('vidplot:offer-update', info),
    pathForFile: (file) => {
        if (!file || typeof webUtils.getPathForFile !== 'function') return '';
        try {
            return webUtils.getPathForFile(file) || '';
        } catch {
            return '';
        }
    },
    onOpenPath: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const handler = (_event, filePath) => {
            callback(filePath);
        };
        ipcRenderer.on('vidplot:open-path', handler);
        return () => ipcRenderer.removeListener('vidplot:open-path', handler);
    },
    notifyReady: () => {
        ipcRenderer.send('vidplot:renderer-ready');
    },
});
