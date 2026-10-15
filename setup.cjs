const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { unzipSync } = require('fflate');
const { spawn } = require('node:child_process');

async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, cwd: options.cwd, signal: options.signal, env: { ...process.env, ...options.env } });
    let output = '';
    let error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('La operación superó su tiempo máximo. Puedes volver a intentarlo.')); }, options.timeout || 30 * 60_000);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-10000); options.onLog?.(chunk.toString()); });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-5000); options.onLog?.(chunk.toString()); });
    child.once('error', failure => { clearTimeout(timer); reject(failure); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error(error.trim() || `El proceso terminó con código ${code}.`)); });
  });
}

async function download(url, signal) {
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000), headers: { 'User-Agent': 'MINA-Voice-Studio' } });
  if (!response.ok) throw new Error(`No se pudo descargar un componente (${response.status}). Comprueba la conexión.`);
  return Buffer.from(await response.arrayBuffer());
}

async function installEngine(dataDir, engineDir, device, progress, signal) {
  const tools = path.join(dataDir, 'tools');
  await fs.mkdir(tools, { recursive: true });
  const uv = path.join(tools, 'uv.exe');
  try { await fs.access(uv); } catch {
    progress('Descargando el preparador de Python…');
    const metadata = JSON.parse((await download('https://api.github.com/repos/astral-sh/uv/releases/latest', signal)).toString());
    const name = 'uv-x86_64-pc-windows-msvc.zip';
    const archive = metadata.assets.find(item => item.name === name);
    const checksum = metadata.assets.find(item => item.name === name + '.sha256');
    if (!archive || !checksum) throw new Error('No encontré el instalador de Python para Windows x64.');
    const bytes = await download(archive.browser_download_url, signal);
    const expected = (await download(checksum.browser_download_url, signal)).toString().trim().split(/\s+/)[0];
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('La descarga no pasó la verificación de integridad.');
    const unpacked = unzipSync(bytes);
    const key = Object.keys(unpacked).find(item => item === 'uv.exe' || item.endsWith('/uv.exe'));
    if (!key) throw new Error('El archivo descargado no contiene uv.exe.');
    await fs.writeFile(uv, unpacked[key]);
  }
  const env = { UV_PYTHON_INSTALL_DIR: path.join(dataDir, 'python'), UV_CACHE_DIR: path.join(dataDir, 'download-cache'), UV_NO_PROGRESS: '1' };
  const execute = (args) => run(uv, args, { env, signal, onLog: line => progress(line.trim().slice(-400)) });
  progress('Preparando Python 3.11 para esta aplicación…');
  await execute(['python', 'install', '3.11', '--no-bin', '--no-registry']);
  const venv = path.join(dataDir, 'voice-engine');
  const python = path.join(venv, 'Scripts', 'python.exe');
  try { await fs.access(python); } catch { await execute(['venv', '--python', '3.11', '--managed-python', venv]); }
  progress(`Instalando PyTorch ${device === 'cuda' ? 'para NVIDIA' : 'para CPU'}; la descarga puede ocupar varios GB…`);
  await execute(['pip', 'install', '--python', python, 'torch==2.8.0', 'torchaudio==2.8.0', '--index-url', `https://download.pytorch.org/whl/${device === 'cuda' ? 'cu128' : 'cpu'}`, '--reinstall-package', 'torch', '--reinstall-package', 'torchaudio']);
  progress('Instalando el motor de voz y sus dependencias…');
  await execute(['pip', 'install', '--python', python, '-r', path.join(engineDir, 'requirements.txt'), '-c', path.join(engineDir, 'constraints.txt')]);
  await execute(['pip', 'install', '--python', python, '--no-deps', 'chatterbox-tts==0.1.7']);
  progress('Verificando el motor…');
  await run(python, ['-c', 'import torch, soundfile, chatterbox; print("CUDA:", torch.cuda.is_available())'], { timeout: 120000 });
  return python;
}

module.exports = { run, installEngine };
