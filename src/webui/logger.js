'use strict';

const ring        = [];
const MAX         = 500;
const subscribers = new Set();

// ── In-memory stats ───────────────────────────────────────────────────────────
const stats = {
  commandCounts: {},   // { commandName: count }
  totalCommands: 0,
  memberJoins:   0,
  memberLeaves:  0,
  tracksPlayed:  0,
  modActions:    0,
};

// ── Log entry broadcast ───────────────────────────────────────────────────────
function push(level, category, msg) {
  const entry = { level, category, ts: new Date().toISOString(), msg };
  ring.push(entry);
  if (ring.length > MAX) ring.shift();
  for (const ws of subscribers) {
    if (ws.readyState === 1) ws.send(JSON.stringify(entry));
  }
}

// ── Structured action logger (called directly by bot code) ───────────────────
function logAction(category, msg) {
  process.stdout.write(`[${category.toUpperCase()}] ${msg}\n`);
  push('action', category, msg);

  // Update stats counters
  if (category === 'member-join')  stats.memberJoins++;
  if (category === 'member-leave') stats.memberLeaves++;
  if (category === 'music')        stats.tracksPlayed++;
  if (category === 'moderation')   stats.modActions++;
}

function logCommand(name, user, guild) {
  stats.commandCounts[name] = (stats.commandCounts[name] ?? 0) + 1;
  stats.totalCommands++;
  push('action', 'command', `/${name} — ${user} in ${guild}`);
  process.stdout.write(`[COMMAND] /${name} — ${user} in ${guild}\n`);
}

// ── Patch console.* ──────────────────────────────────────────────────────────
const _log   = console.log.bind(console);
const _warn  = console.warn.bind(console);
const _error = console.error.bind(console);

console.log   = (...a) => { _log(...a);   push('info',  'system', a.map(String).join(' ')); };
console.warn  = (...a) => { _warn(...a);  push('warn',  'system', a.map(String).join(' ')); };
console.error = (...a) => { _error(...a); push('error', 'system', a.map(String).join(' ')); };

module.exports = { ring, subscribers, stats, logAction, logCommand };
