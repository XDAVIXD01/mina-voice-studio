const fs = require('node:fs');
const readline = require('node:readline');
const waiting = process.env.WAIT_TO_READY === '1';
setTimeout(() => console.log(JSON.stringify({ type: 'ready', device: 'cpu' })), waiting ? 500 : 0);
readline.createInterface({ input: process.stdin }).on('line', line => {
  const job = JSON.parse(line);
  if (job.text === 'crash') { process.exit(2); return; }
  fs.writeFileSync(job.out, Buffer.alloc(2000));
  console.log(JSON.stringify({ type: 'done', id: job.id, out: job.out }));
});
