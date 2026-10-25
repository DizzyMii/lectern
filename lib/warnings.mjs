// node 22 flags fs.glob as experimental. Only that warning is hidden; every other one still prints.
let done = false;
export function quietGlobWarning() {
  if (done) return;
  done = true;
  process.removeAllListeners('warning');
  process.on('warning', (w) => {
    if (w.name === 'ExperimentalWarning' && /glob/i.test(w.message)) return;
    process.stderr.write(`(node:${process.pid}) ${w.name}: ${w.message}\n`);
  });
}
