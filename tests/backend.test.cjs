const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, stat, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { StudioEngine } = require('../backend.cjs');
const { run } = require('../setup.cjs');
const ffmpeg = require('ffmpeg-static');

test('el importador normaliza audio y rechaza archivos inválidos', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mina-studio-import-'));
  const engine = new StudioEngine({ dataDir, engineDir: '.', ffmpeg, notify() {} });
  try {
    const source = path.join(dataDir, 'reference.mp3');
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', source]);
    const imported = await engine.importReference(source);
    assert.equal(imported.seconds, 4);
    assert.ok((await stat(imported.file)).size > 190000);
    const invalid = path.join(dataDir, 'invalid.wav');
    await writeFile(invalid, 'esto no es audio');
    await assert.rejects(engine.importReference(invalid));
  } finally { engine.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test('se recupera después de que el proceso de voz muere', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mina-studio-recover-'));
  const engine = new StudioEngine({ dataDir, engineDir: '.', ffmpeg, notify() {},
    spawnProcess: (_command, _args, options) => spawn(process.execPath, [path.join(__dirname, 'fake-worker.cjs')], options) });
  try {
    await assert.rejects(engine.generate('fake', { file: 'test' }, { text: 'crash', device: 'cpu' }));
    const result = await engine.generate('fake', { file: 'test' }, { text: 'hola', device: 'cpu' });
    assert.ok(result.out.endsWith('.wav'));
  } finally { engine.close(); await new Promise(resolve => setTimeout(resolve, 150)); await rm(dataDir, { recursive: true, force: true }); }
});

test('cancelar durante la carga rechaza la petición y permite otra carga', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mina-studio-cancel-'));
  const engine = new StudioEngine({ dataDir, engineDir: '.', ffmpeg, notify() {},
    spawnProcess: (_command, _args, options) => spawn(process.execPath, [path.join(__dirname, 'fake-worker.cjs')], { ...options, env: { ...options.env, WAIT_TO_READY: '1' } }) });
  try {
    const pending = engine.load('fake', 'cpu');
    const rejected = assert.rejects(pending);
    setTimeout(() => engine.unload(), 50);
    await rejected;
    await engine.load('fake', 'cpu');
    assert.ok(engine.worker);
  } finally { engine.close(); await new Promise(resolve => setTimeout(resolve, 150)); await rm(dataDir, { recursive: true, force: true }); }
});
