const { spawn } = require('node:child_process');
const readline = require('node:readline');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { run } = require('./setup.cjs');

class StudioEngine {
  constructor({ dataDir, engineDir, ffmpeg, notify, spawnProcess = spawn }) {
    this.dataDir = dataDir; this.engineDir = engineDir; this.ffmpeg = ffmpeg; this.notify = notify;
    this.spawnProcess = spawnProcess;
    this.worker = null; this.loading = null; this.pending = new Map(); this.device = ''; this.lastUsed = Date.now();
    this.idle = setInterval(() => { if (!this.pending.size && !this.loading && Date.now() - this.lastUsed > 120000) this.unload(); }, 15000);
    this.idle.unref();
  }
  async importReference(source) {
    const info = await fs.stat(source);
    if (info.size > 100 * 1024 * 1024) throw new Error('La referencia debe pesar menos de 100 MB.');
    const id = randomUUID();
    const output = path.join(this.dataDir, 'references', id + '.wav');
    await fs.mkdir(path.dirname(output), { recursive: true });
    try {
      await run(this.ffmpeg, ['-v', 'error', '-i', source, '-t', '30', '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', output], { timeout: 60000 });
      const header = await fs.readFile(output);
      if (header.length < 3 * 24000 * 2) throw new Error('Usa al menos 3 segundos de voz clara.');
      return { id, name: path.basename(source), file: output, seconds: Math.round((header.length - 44) / 48000) };
    } catch (error) { await fs.rm(output, { force: true }); throw error; }
  }
  unload() {
    const child = this.worker;
    this.worker = null; this.loading = null; this.device = '';
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(new Error('Generación cancelada.')); }
    this.pending.clear();
    if (child) {
      child.kill();
      this.notify({ phase: 'idle', message: 'Motor descargado. Recursos liberados.' });
    }
  }
  async load(python, device) {
    if (this.worker && this.device !== device) this.unload();
    if (this.loading) return this.loading;
    if (this.worker) return;
    this.lastUsed = Date.now();
    this.device = device;
    const child = this.spawnProcess(python, ['-u', path.join(this.engineDir, 'worker.py')], {
      cwd: this.dataDir, windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', STUDIO_DEVICE: device, HF_HOME: path.join(this.dataDir, 'models'), HF_HUB_DISABLE_PROGRESS_BARS: '1' },
    });
    this.worker = child;
    let resolveReady, rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    this.loading = ready;
    const timer = setTimeout(() => fail(new Error('El modelo tardó demasiado en cargar. Revisa la conexión y vuelve a intentar.')), 15 * 60_000);
    const lines = readline.createInterface({ input: child.stdout });
    let logTail = '';
    const fail = error => {
      clearTimeout(timer); rejectReady(error);
      if (this.worker === child) {
        this.worker = null; this.loading = null;
        for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); }
        this.pending.clear();
      }
      child.kill(); lines.close();
    };
    child.stderr.on('data', chunk => {
      logTail = (logTail + chunk).slice(-12000);
      fs.appendFile(path.join(this.dataDir, 'engine.log'), chunk).catch(() => {});
    });
    child.on('error', fail); child.stdin.on('error', fail);
    child.once('close', code => fail(new Error(`El motor se cerró (${code}). ${logTail.split(/\r?\n/).filter(Boolean).slice(-1).join('').slice(0, 350)}`)));
    lines.on('line', line => {
      let event; try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'ready') { clearTimeout(timer); resolveReady(event); this.notify({ phase: 'ready', message: `Motor listo · ${event.device === 'cuda' ? 'GPU NVIDIA' : 'CPU'}` }); }
      else if (event.type === 'fatal') fail(new Error(event.error));
      else if (event.type === 'progress') this.notify({ phase: 'generating', message: `Generando fragmento ${event.current} de ${event.total}…` });
      else if (event.id) {
        const job = this.pending.get(event.id); if (!job) return;
        clearTimeout(job.timer); this.pending.delete(event.id);
        if (event.type === 'done') job.resolve(event); else job.reject(new Error(event.error));
      }
    });
    try { await ready; } finally { if (this.loading === ready) this.loading = null; }
  }
  async generate(python, reference, options) {
    await this.load(python, options.device);
    const worker = this.worker;
    if (!worker || worker.stdin.destroyed) throw new Error('El motor no está disponible. Vuelve a generar.');
    const id = randomUUID();
    const out = path.join(this.dataDir, 'generated', id + '.wav');
    await fs.mkdir(path.dirname(out), { recursive: true });
    this.lastUsed = Date.now();
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.unload(), 15 * 60_000);
        this.pending.set(id, { resolve, reject, timer });
        worker.stdin.write(JSON.stringify({ ...options, id, reference: reference.file, out }) + '\n', error => {
          if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
        });
      });
    } catch (error) { await fs.rm(out, { force: true }).catch(() => {}); throw error; }
    finally { this.lastUsed = Date.now(); }
  }
  close() { clearInterval(this.idle); this.unload(); }
}
module.exports = { StudioEngine };
