const $ = id => document.getElementById(id);
let ready = false;
let reference;
let working = false;
let selected;
let history = [];

function feedback(message, phase = 'idle') {
  $('status-message').textContent = message;
  $('status').className = phase === 'error' ? 'error' : ['loading', 'generating', 'installing', 'importing'].includes(phase) ? 'working' : '';
}
function buttons() {
  $('generate').disabled = working || !ready || !reference || !$('text').value.trim();
  for (const id of ['import', 'setup', 'python', 'device', 'language', 'text', 'expression', 'unload']) $(id).disabled = working;
  $('cancel').hidden = !working;
}
function referenceUI(value) {
  reference = value;
  if (!value) return;
  $('reference-info').hidden = false;
  $('reference-name').textContent = value.name;
  $('reference-duration').textContent = `${value.seconds} segundos · referencia preparada`;
  $('reference-player').src = `mina-audio://reference/${value.id}.wav`;
  buttons();
}
async function refresh() {
  const state = await window.studio.status();
  ready = state.engineAvailable;
  $('engine-title').textContent = ready ? 'Motor instalado' : 'Motor por preparar';
  $('engine-dot').className = ready ? 'dot ready' : 'dot';
  $('engine-info').textContent = ready ? 'El motor está disponible para generar voz.' : 'Descarga Python, el motor y sus dependencias. Necesita varios GB de espacio.';
  $('setup').textContent = ready ? 'Preparar / reparar motor' : 'Preparar motor';
  referenceUI(state.reference);
  buttons();
}
async function operation(fn) {
  working = true; buttons();
  try { return await fn(); }
  catch (error) { feedback(error.message, 'error'); }
  finally { working = false; await refresh().catch(() => {}); buttons(); }
}
function showAudio(item) {
  selected = item;
  $('empty-output').hidden = true;
  $('output').hidden = false;
  $('player').src = item.url;
  $('output-meta').textContent = `${item.seconds.toFixed(1)} segundos`;
}
function renderHistory() {
  $('history').replaceChildren();
  if (!history.length) {
    const empty = document.createElement('p'); empty.className = 'tiny'; empty.textContent = 'Aún no has generado ningún audio.'; $('history').append(empty); return;
  }
  for (const item of history) {
    const row = document.createElement('div'); row.className = 'history-item';
    const play = document.createElement('button'); play.textContent = '▶'; play.title = 'Escuchar audio';
    play.addEventListener('click', () => { showAudio(item); $('player').play().catch(() => {}); });
    const text = document.createElement('span'); text.className = 'history-text'; text.textContent = item.text;
    const time = document.createElement('small'); time.textContent = new Date(item.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    row.append(play, text, time); $('history').append(row);
  }
}
$('text').addEventListener('input', () => { $('count').textContent = `${$('text').value.length} / 5000`; buttons(); });
$('expression').addEventListener('input', () => { const value = Number($('expression').value); $('expression-label').textContent = value < .45 ? 'Suave' : value > .75 ? 'Expresiva' : 'Equilibrada'; });
$('import').addEventListener('click', () => operation(async () => { const result = await window.studio.import(); if (result) referenceUI(result); }));
$('setup').addEventListener('click', () => operation(async () => { await window.studio.setup($('device').value); feedback('Motor preparado. Ya puedes generar tu primer audio.'); }));
$('python').addEventListener('click', () => operation(async () => { if (await window.studio.python()) feedback('Entorno Python conectado.'); }));
$('generate').addEventListener('click', () => operation(async () => {
  const result = await window.studio.generate({ text: $('text').value, device: $('device').value, language: $('language').value, expression: Number($('expression').value) });
  showAudio(result); history = [result, ...history]; renderHistory();
}));
$('cancel').addEventListener('click', async () => { try { await window.studio.cancel(); feedback('Operación cancelada.'); } catch (error) { feedback(error.message, 'error'); } });
$('unload').addEventListener('click', async () => { try { await window.studio.unload(); feedback('Motor descargado. Recursos liberados.'); } catch (error) { feedback(error.message, 'error'); } });
$('save').addEventListener('click', async () => { if (selected) { try { if (await window.studio.save(selected.id)) feedback('Audio WAV guardado.'); } catch (error) { feedback(error.message, 'error'); } } });
window.studio.onProgress(event => feedback(event.message, event.phase));
(async () => {
  try {
    const state = await window.studio.status(); $('device').value = state.device;
    await refresh(); history = await window.studio.history(); renderHistory();
  } catch (error) { feedback(error.message, 'error'); }
})();
