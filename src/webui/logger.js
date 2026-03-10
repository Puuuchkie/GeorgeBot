'use strict';

const ring        = [];
const MAX         = 500;
const subscribers = new Set();

function push(level, args) {
  const entry = { level, ts: new Date().toISOString(), msg: args.map(String).join(' ') };
  ring.push(entry);
  if (ring.length > MAX) ring.shift();
  for (const ws of subscribers) {
    if (ws.readyState === 1) ws.send(JSON.stringify(entry));
  }
}

const _log   = console.log.bind(console);
const _warn  = console.warn.bind(console);
const _error = console.error.bind(console);

console.log   = (...a) => { _log(...a);   push('info',  a); };
console.warn  = (...a) => { _warn(...a);  push('warn',  a); };
console.error = (...a) => { _error(...a); push('error', a); };

module.exports = { ring, subscribers };
