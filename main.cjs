const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { StudioEngine } = require('./backend.cjs');
const { installEngine, run } = require('./setup.cjs');

app.setName('MINA Voice Studio');
protocol.registerSchemesAsPrivileged([{ scheme: 'mina-audio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const argument = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
if (argument('data-dir')) {
  require('node:fs').mkdirSync(argument('data-dir'), { recursive: true });
  app.setPath('userData', argument('data-dir'));
}
let window, engine, dataDir, config, engineDir, ffmpeg, reference;
let busy = false;
let setupController;
const generated = new Map();
const references = new Map();
let current = { phase: 'idle', message: 'Carga una referencia y escribe lo que quieres escuchar.' };

function notify(event) {
  current = { ...event, busy };
  if (window && !window.isDestroyed()) window.webContents.send('studio:progress', current);
}
async function saveConfig() { await fs.writeFile(path.join(dataDir, 'settings.json'), JSON.stringify(config, null, 2)); }
async function status() {
  let available = false;
  try { await fs.access(config.python || ''); available = true; } catch {}
  return { ...current, busy, engineAvailable: available, device: config.device || 'cuda', reference: reference ? { id: reference.id, name: reference.name, seconds: reference.seconds } : null };
}
async function importReference(source) {
  if (busy) throw new Error('Espera a que termine la operación actual.');
  notify({ phase: 'importing', message: 'Preparando referencia…' });
  const imported = await engine.importReference(source);
  reference = imported;
  references.set(imported.id, imported.file);
  config.reference = imported;
  await saveConfig();
  notify({ phase: 'idle', message: `Referencia lista · ${imported.seconds} segundos` });
  return { id: imported.id, name: imported.name, seconds: imported.seconds };
}
async function prepare(device) {
  if (busy) throw new Error('Ya hay una operación en curso.');
  if (!['cpu', 'cuda'].includes(device)) throw new Error('Selecciona CPU o NVIDIA.');
  busy = true; setupController = new AbortController(); engine.unload();
  try {
    config.python = await installEngine(dataDir, engineDir, device, message => notify({ phase: 'installing', message }), setupController.signal);
    config.device = device;
    await saveConfig();
    notify({ phase: 'idle', message: 'Motor instalado. La primera generación descargará los modelos de voz.' });
    return true;
  } finally { busy = false; setupController = null; }
}
async function generate(options) {
  if (busy) throw new Error('Ya hay una operación en curso.');
  const text = String(options?.text || '').trim();
  if (!text || text.length > 5000) throw new Error('Escribe entre 1 y 5000 caracteres.');
  if (!reference) throw new Error('Primero carga un audio de referencia.');
  if (!['cpu', 'cuda'].includes(options.device)) throw new Error('Selecciona CPU o NVIDIA.');
  if (!['es', 'en', 'fr', 'pt', 'de', 'it', 'ja'].includes(options.language)) throw new Error('Idioma no admitido.');
  if (!Number.isFinite(Number(options.expression)) || options.expression < 0.25 || options.expression > 0.95) throw new Error('Expresividad fuera del rango permitido.');
  if (!config.python) throw new Error('Primero pulsa Preparar motor.');
  busy = true;
  const chosenReference = reference;
  try {
    notify({ phase: 'loading', message: 'Cargando voz IA… La primera vez puede descargar varios GB.' });
    const result = await engine.generate(config.python, chosenReference, { text, language: options.language, device: options.device, expression: Number(options.expression) });
    const item = { id: result.id, file: result.out, seconds: result.seconds, elapsed_ms: result.elapsed_ms, text: text.slice(0, 140), created: new Date().toISOString() };
    generated.set(item.id, item);
    config.device = options.device;
    await saveConfig();
    await fs.writeFile(path.join(dataDir, 'library.json'), JSON.stringify([...generated.values()], null, 2));
    notify({ phase: 'done', message: `Audio listo · ${result.seconds.toFixed(1)} s · generado en ${(result.elapsed_ms / 1000).toFixed(1)} s` });
    return { ...item, file: undefined, url: `mina-audio://generated/${item.id}.wav` };
  } finally { busy = false; }
}
async function initialise() {
  dataDir = argument('data-dir') || app.getPath('userData');
  engineDir = app.isPackaged ? path.join(process.resourcesPath, 'engine') : path.join(__dirname, 'engine');
  ffmpeg = app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg.exe') : require('ffmpeg-static');
  await fs.mkdir(dataDir, { recursive: true });
  try { config = JSON.parse(await fs.readFile(path.join(dataDir, 'settings.json'), 'utf8')); } catch { config = {}; }
  if (config.reference) {
    try { await fs.access(config.reference.file); reference = config.reference; references.set(reference.id, reference.file); } catch {}
  }
  try {
    const library = JSON.parse(await fs.readFile(path.join(dataDir, 'library.json'), 'utf8'));
    for (const item of library) {
      if (/^[a-f0-9-]{36}$/.test(item.id) && path.resolve(item.file) === path.join(dataDir, 'generated', item.id + '.wav')) generated.set(item.id, item);
    }
  } catch {}
  engine = new StudioEngine({ dataDir, engineDir, ffmpeg, notify });
  protocol.handle('mina-audio', request => {
    const url = new URL(request.url);
    const id = url.pathname.replace(/^\//, '').replace(/\.wav$/, '');
    if (!/^[a-f0-9-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
    const file = url.hostname === 'generated' ? generated.get(id)?.file : url.hostname === 'reference' ? references.get(id) : undefined;
    if (!file) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}
function createWindow() {
  window = new BrowserWindow({ width: 1160, height: 820, minWidth: 930, minHeight: 700, show: false, autoHideMenuBar: true,
    title: 'MINA Voice Studio', icon: path.join(__dirname, 'assets/mina-icon.png'), backgroundColor: '#0b0f19',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.loadFile(path.join(__dirname, 'index.html'));
  window.once('ready-to-show', async () => {
    window.show();
    if (argument('capture-ui')) { await new Promise(resolve => setTimeout(resolve, 1500)); await fs.writeFile(argument('capture-ui'), (await window.webContents.capturePage()).toPNG()); app.quit(); }
  });
}

app.setAppUserModelId('com.xdavixd.minavoicestudio');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    await initialise();
    if (argument('setup-engine')) {
      try { notify = event => console.log(event.message); await prepare(argument('setup-engine')); console.log('SETUP_OK'); }
      catch (error) { console.error(error.message); app.exit(1); return; }
      app.quit(); return;
    }
    if (argument('self-test')) {
      const report = {};
      try {
        await importReference(argument('test-reference'));
        report.reference = { seconds: reference.seconds, bytes: (await fs.stat(reference.file)).size };
        report.generated = await generate({ text: 'Hola, esta es una prueba de Mina Voice Studio.', language: 'es', device: config.device || 'cuda', expression: 0.6 });
        await run(ffmpeg, ['-v', 'error', '-i', generated.get(report.generated.id).file, '-f', 'null', '-'], { timeout: 20000 });
        report.decode = true;
        const preview = await net.fetch(report.generated.url);
        const bytes = Buffer.from(await preview.arrayBuffer());
        if (!preview.ok || bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error('La reproducción previa no recibió un WAV válido.');
        report.preview = true;
        const exported = path.join(dataDir, 'export-check.wav');
        await fs.copyFile(generated.get(report.generated.id).file, exported);
        report.export = (await fs.stat(exported)).size === bytes.length;
      } catch (error) { report.error = error.message; }
      finally { await fs.writeFile(argument('self-test'), JSON.stringify(report, null, 2)); engine.close(); app.exit(report.error ? 1 : 0); }
      return;
    }
    const handle = (name, fn) => ipcMain.handle(`studio:${name}`, async (_event, ...args) => {
      try { return { ok: true, data: await fn(...args) }; }
      catch (error) { notify({ phase: 'error', message: error.message }); return { ok: false, error: error.message }; }
    });
    handle('status', status);
    handle('import', async () => {
      const choice = await dialog.showOpenDialog(window, { title: 'Audio de referencia', properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'flac', 'aac', 'opus', 'webm'] }] });
      if (choice.canceled) return null;
      return importReference(choice.filePaths[0]);
    });
    handle('generate', generate);
    handle('setup', prepare);
    handle('cancel', () => { setupController?.abort(); engine.unload(); return true; });
    handle('unload', () => { if (busy) throw new Error('Cancela la generación antes de liberar el motor.'); engine.unload(); return true; });
    handle('python', async () => {
      if (busy) throw new Error('Espera a que termine la operación actual.');
      const selection = await dialog.showOpenDialog(window, { title: 'Seleccionar Python con Chatterbox instalado', properties: ['openFile'], filters: [{ name: 'Python', extensions: ['exe'] }] });
      if (selection.canceled) return false;
      await run(selection.filePaths[0], ['-c', 'import torch, chatterbox, soundfile; print(torch.__version__)'], { timeout: 60000 });
      engine.unload(); config.python = selection.filePaths[0]; await saveConfig(); return true;
    });
    handle('save', async id => {
      const item = generated.get(id); if (!item) throw new Error('No encontré este audio.');
      const result = await dialog.showSaveDialog(window, { title: 'Guardar audio WAV', defaultPath: `MINA-${item.created.slice(0, 10)}.wav`, filters: [{ name: 'WAV', extensions: ['wav'] }] });
      if (result.canceled) return false;
      if (path.resolve(result.filePath) !== path.resolve(item.file)) await fs.copyFile(item.file, result.filePath);
      return true;
    });
    handle('history', () => [...generated.values()].reverse().slice(0, 50).map(item => ({ ...item, file: undefined, url: `mina-audio://generated/${item.id}.wav` })));
    createWindow();
  }).catch(error => { dialog.showErrorBox('MINA Voice Studio', error.message); app.exit(1); });
}
app.on('before-quit', () => { setupController?.abort(); engine?.close(); });
app.on('window-all-closed', () => app.quit());
