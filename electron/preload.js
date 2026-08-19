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
});
