const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (name, ...args) => {
  const result = await ipcRenderer.invoke(`studio:${name}`, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.data;
};
contextBridge.exposeInMainWorld('studio', {
  status: () => invoke('status'), import: () => invoke('import'), setup: device => invoke('setup', device),
  generate: options => invoke('generate', options), cancel: () => invoke('cancel'), unload: () => invoke('unload'),
  save: id => invoke('save', id), history: () => invoke('history'), python: () => invoke('python'),
  onProgress: callback => { const listener = (_event, data) => callback(data); ipcRenderer.on('studio:progress', listener); return () => ipcRenderer.removeListener('studio:progress', listener); },
});
