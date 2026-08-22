const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('vidplotDesktop', {
    isDesktop: true,
    openVideo: () => ipcRenderer.invoke('vidplot:open-video'),
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
