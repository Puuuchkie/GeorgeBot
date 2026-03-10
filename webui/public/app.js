'use strict';

// ── State ───────────────────────────────────────────────────────────────────
const state = {
  ws:             null,
  selectedGuild:  null,
  statusInterval: null,
  musicInterval:  null,
  logFilter:      '',       // active category filter on Logs page
  allLogs:        [],       // full log buffer for filtering
};

// ── Utilities ───────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (res.status === 401) { location.href = '/login'; throw new Error('Unauthorized'); }
  return res;
}

function toast(msg, isErr = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'show' + (isErr ? ' err' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.className = '', 3000);
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Navigation ──────────────────────────────────────────────────────────────
function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
  document.getElementById(`section-${name}`).classList.add('active');
  document.querySelector(`[data-section="${name}"]`).classList.add('active');

  if (name === 'controls') {
    loadControlsGuilds();
    refreshMusicQueues();
    clearInterval(state.musicInterval);
    state.musicInterval = setInterval(refreshMusicQueues, 5000);
  } else {
    clearInterval(state.musicInterval);
  }
}

document.querySelectorAll('.nav-link').forEach(a => {
  a.addEventListener('click', () => showSection(a.dataset.section));
});

// ── Logout ──────────────────────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.href = '/login';
});

// ── Status polling ──────────────────────────────────────────────────────────
async function refreshStatus() {
  try {
    const res  = await api('/api/status');
    const data = await res.json();

    const dot = document.getElementById('status-dot');
    dot.className = 'dot ' + (data.online ? 'online' : 'offline');
    document.getElementById('status-text').textContent = data.online ? 'Online' : 'Offline';
    if (data.avatar) document.getElementById('bot-avatar').src = data.avatar;
    if (data.tag)    document.getElementById('bot-tag').textContent = data.tag;

    document.getElementById('card-status').textContent = data.online ? 'Online' : 'Offline';
    document.getElementById('card-status').style.color = data.online ? 'var(--green)' : 'var(--red)';
    document.getElementById('card-guilds').textContent      = data.guildCount;
    document.getElementById('card-uptime').textContent      = fmtUptime(data.uptime);
    document.getElementById('card-uptime-sub').textContent  = `${data.uptime}s total`;
    document.getElementById('card-memory').textContent      = `${data.memoryMB} MB`;
    document.getElementById('card-memory-sub').textContent  = `of ${data.memTotalMB} MB heap`;
  } catch {}
}

async function refreshStats() {
  try {
    const res  = await api('/api/stats');
    const data = await res.json();
    document.getElementById('card-commands').textContent     = data.totalCommands;
    document.getElementById('card-commands-sub').textContent = `${data.topCommands.length} unique`;
    document.getElementById('card-tracks').textContent       = data.tracksPlayed;
    document.getElementById('card-joins').textContent        = data.memberJoins;
    document.getElementById('card-modactions').textContent   = data.modActions;
    document.getElementById('card-members-sub').textContent  = `${data.totalMembers.toLocaleString()} members total`;

    const el = document.getElementById('top-commands');
    if (!data.topCommands.length) {
      el.innerHTML = '<p style="color:var(--muted);font-size:13px">No commands run yet this session.</p>';
    } else {
      const max = data.topCommands[0].count;
      el.innerHTML = data.topCommands.map(c => `
        <div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
            <span style="color:var(--text)">/${escHtml(c.name)}</span>
            <span style="color:var(--muted)">${c.count}</span>
          </div>
          <div style="background:var(--bg3);border-radius:4px;height:4px">
            <div style="background:var(--accent);width:${Math.round(c.count/max*100)}%;height:4px;border-radius:4px"></div>
          </div>
        </div>`).join('');
    }
  } catch {}
}

// ── Guild list ──────────────────────────────────────────────────────────────
async function loadGuilds() {
  const res    = await api('/api/guilds');
  const guilds = await res.json();
  const list   = document.getElementById('guild-list');
  list.innerHTML = '';
  guilds.forEach(g => {
    const row = document.createElement('div');
    row.className = 'guild-row';
    row.innerHTML = `
      <img src="${g.icon || '/icon.png'}" onerror="this.src='/icon.png'" alt="">
      <div>
        <div class="gname">${escHtml(g.name)}</div>
        <div class="gmeta">${g.memberCount.toLocaleString()} members · ID: ${g.id}</div>
      </div>
      <span class="arrow">›</span>`;
    row.addEventListener('click', () => openGuildConfig(g));
    list.appendChild(row);
  });
}

// ── Guild config panel ───────────────────────────────────────────────────────
async function openGuildConfig(guild) {
  state.selectedGuild = guild;
  const panel = document.getElementById('config-panel');
  panel.classList.add('open');
  document.getElementById('config-title').innerHTML =
    `<img src="${guild.icon || '/icon.png'}" onerror="this.src='/icon.png'" alt="">${escHtml(guild.name)}`;

  switchTab('welcome');
  const res    = await api(`/api/guilds/${guild.id}/config`);
  const config = await res.json();
  document.getElementById('wc-channel').value = config.welcome?.channelId || '';
  document.getElementById('wc-message').value = config.welcome?.message  || '';
  document.getElementById('wc-dm').checked    = !!config.welcome?.dm;
  document.getElementById('wc-dmmsg').value   = config.welcome?.dmMessage || '';
  document.getElementById('gb-channel').value = config.goodbye?.channelId || '';
  document.getElementById('gb-message').value = config.goodbye?.message  || '';
  document.getElementById('ar-role').value    = config.autorole || '';
  panel.scrollIntoView({ behavior: 'smooth' });
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'warnings' && state.selectedGuild) loadWarnings(state.selectedGuild.id);
}

document.getElementById('save-welcome').addEventListener('click', async () => {
  if (!state.selectedGuild) return;
  await saveConfig({ welcome: {
    channelId: document.getElementById('wc-channel').value.trim(),
    message:   document.getElementById('wc-message').value.trim(),
    dm:        document.getElementById('wc-dm').checked,
    dmMessage: document.getElementById('wc-dmmsg').value.trim(),
  }});
});
document.getElementById('save-goodbye').addEventListener('click', async () => {
  if (!state.selectedGuild) return;
  await saveConfig({ goodbye: {
    channelId: document.getElementById('gb-channel').value.trim(),
    message:   document.getElementById('gb-message').value.trim(),
  }});
});
document.getElementById('save-autorole').addEventListener('click', async () => {
  if (!state.selectedGuild) return;
  await saveConfig({ autorole: document.getElementById('ar-role').value.trim() || null });
});

async function saveConfig(body) {
  try {
    const res = await api(`/api/guilds/${state.selectedGuild.id}/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    res.ok ? toast('Saved!') : toast('Save failed', true);
  } catch { toast('Save failed', true); }
}

async function loadWarnings(guildId) {
  const container = document.getElementById('warnings-content');
  container.innerHTML = '<p style="color:var(--muted)">Loading…</p>';
  try {
    const res  = await api(`/api/guilds/${guildId}/warnings`);
    const data = await res.json();
    const entries = Object.entries(data);
    if (!entries.length) {
      container.innerHTML = '<p class="no-warns">No warnings recorded for this guild.</p>';
      return;
    }
    let html = `<table class="warn-table">
      <thead><tr><th>User ID</th><th>Warnings</th><th>Latest Reason</th></tr></thead><tbody>`;
    for (const [userId, warns] of entries) {
      const last = warns[warns.length - 1];
      html += `<tr>
        <td>${escHtml(userId)}</td>
        <td><span class="warn-count">${warns.length}</span></td>
        <td>${escHtml(last?.reason || '—')}</td>
      </tr>`;
    }
    container.innerHTML = html + '</tbody></table>';
  } catch {
    container.innerHTML = '<p style="color:var(--red)">Failed to load warnings.</p>';
  }
}

// ── Controls ─────────────────────────────────────────────────────────────────

// Load guilds into announce guild dropdown
async function loadControlsGuilds() {
  const res    = await api('/api/guilds');
  const guilds = await res.json();
  const sel    = document.getElementById('ctrl-ann-guild');
  sel.innerHTML = '<option value="">— Select a guild —</option>';
  guilds.forEach(g => {
    const opt = document.createElement('option');
    opt.value       = g.id;
    opt.textContent = g.name;
    sel.appendChild(opt);
  });
}

// When a guild is selected in announce, load its channels
document.getElementById('ctrl-ann-guild').addEventListener('change', async function () {
  const chanSel = document.getElementById('ctrl-ann-channel');
  chanSel.innerHTML = '<option value="">Loading…</option>';
  chanSel.disabled  = true;
  if (!this.value) {
    chanSel.innerHTML = '<option value="">— Select a guild first —</option>';
    return;
  }
  try {
    const res      = await api(`/api/channels/${this.value}`);
    const channels = await res.json();
    chanSel.innerHTML = '<option value="">— Select a channel —</option>';
    channels.forEach(c => {
      const opt = document.createElement('option');
      opt.value       = c.id;
      opt.textContent = `#${c.name}`;
      chanSel.appendChild(opt);
    });
    chanSel.disabled = false;
  } catch {
    chanSel.innerHTML = '<option value="">Failed to load channels</option>';
  }
});

// Set presence
document.getElementById('ctrl-set-presence').addEventListener('click', async () => {
  const btn = document.getElementById('ctrl-set-presence');
  btn.disabled = true;
  try {
    const res = await api('/api/activity', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: document.getElementById('ctrl-status').value,
        type:   document.getElementById('ctrl-activity-type').value,
        text:   document.getElementById('ctrl-activity-text').value,
      }),
    });
    res.ok ? toast('Presence updated!') : toast('Failed to update presence', true);
  } catch { toast('Failed', true); }
  btn.disabled = false;
});

// Send announcement
document.getElementById('ctrl-send-ann').addEventListener('click', async () => {
  const guildId   = document.getElementById('ctrl-ann-guild').value;
  const channelId = document.getElementById('ctrl-ann-channel').value;
  const message   = document.getElementById('ctrl-ann-msg').value.trim();
  if (!guildId || !channelId || !message) return toast('Fill in all fields', true);

  const btn = document.getElementById('ctrl-send-ann');
  btn.disabled = true;
  try {
    const res = await api('/api/announce', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId, channelId, message }),
    });
    if (res.ok) {
      toast('Announcement sent!');
      document.getElementById('ctrl-ann-msg').value = '';
    } else {
      const err = await res.json();
      toast(err.error || 'Send failed', true);
    }
  } catch { toast('Send failed', true); }
  btn.disabled = false;
});

// Music queue controls
async function refreshMusicQueues() {
  try {
    const res    = await api('/api/music');
    const queues = await res.json();
    const el     = document.getElementById('ctrl-music-queues');

    if (!queues.length) {
      el.innerHTML = '<p style="color:var(--muted);font-size:14px;margin-top:8px">No music playing.</p>';
      return;
    }

    el.innerHTML = queues.map(q => `
      <div class="music-queue-card">
        <img src="${q.guildIcon || '/icon.png'}" onerror="this.src='/icon.png'" alt="">
        <div class="music-queue-info">
          <div class="mq-guild">${escHtml(q.guildName)}</div>
          <div class="mq-track">${q.current ? escHtml(q.current.title) : 'Nothing playing'}</div>
          <div class="mq-meta">
            ${q.isPaused ? '⏸ Paused · ' : '▶ Playing · '}
            Vol ${q.volume}% ·
            ${q.queueLength} in queue
            ${q.loop ? ' · 🔁 Loop' : ''}
          </div>
        </div>
        <div class="music-queue-actions">
          <button class="mq-btn skip" onclick="mqAction('${q.guildId}','skip')">⏭ Skip</button>
          <button class="mq-btn stop" onclick="mqAction('${q.guildId}','stop')">⏹ Stop</button>
        </div>
      </div>`).join('');
  } catch {}
}

async function mqAction(guildId, action) {
  try {
    await api(`/api/music/${guildId}/${action}`, { method: 'POST' });
    toast(action === 'skip' ? 'Skipped!' : 'Stopped!');
    setTimeout(refreshMusicQueues, 1000);
  } catch { toast('Action failed', true); }
}

// ── Live logs ────────────────────────────────────────────────────────────────
const LOG_MAX = 1000;

function makeLogLine(entry) {
  const line = document.createElement('span');
  line.className        = `log-line ${entry.level}`;
  line.dataset.category = entry.category || 'system';
  const ts  = new Date(entry.ts).toLocaleTimeString();
  const cat = entry.category && entry.category !== 'system'
    ? `<span class="log-cat ${escHtml(entry.category)}">${escHtml(entry.category)}</span>`
    : '';
  line.innerHTML = `<span class="log-ts">${ts}</span>${cat}${escHtml(entry.msg)}`;
  return line;
}

function appendLog(entry, container, respectFilter = false) {
  if (respectFilter && state.logFilter && entry.category !== state.logFilter) return;

  const line = makeLogLine(entry);
  container.appendChild(line);
  container.appendChild(document.createTextNode('\n'));

  while (container.childNodes.length > LOG_MAX * 2) container.removeChild(container.firstChild);

  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  if (nearBottom) container.scrollTop = container.scrollHeight;
}

function applyLogFilter() {
  const container = document.getElementById('log-output-full');
  container.innerHTML = '';
  const filtered = state.logFilter
    ? state.allLogs.filter(e => e.category === state.logFilter)
    : state.allLogs;
  for (const entry of filtered.slice(-LOG_MAX)) {
    container.appendChild(makeLogLine(entry));
    container.appendChild(document.createTextNode('\n'));
  }
  container.scrollTop = container.scrollHeight;
}

// Filter buttons
document.getElementById('log-filters').addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('#log-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.logFilter = btn.dataset.cat;
  applyLogFilter();
});

document.getElementById('log-clear-btn').addEventListener('click', () => {
  state.allLogs = [];
  document.getElementById('log-output-full').innerHTML = '';
});

function connectLogs() {
  if (state.ws) state.ws.close();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws/logs`);
  state.ws = ws;

  ws.onmessage = e => {
    const entry = JSON.parse(e.data);
    state.allLogs.push(entry);
    if (state.allLogs.length > LOG_MAX) state.allLogs.shift();

    appendLog(entry, document.getElementById('log-output'));
    appendLog(entry, document.getElementById('log-output-full'), true);
  };

  ws.onclose = () => setTimeout(connectLogs, 3000);
  ws.onerror = () => ws.close();
}

// ── Restart ──────────────────────────────────────────────────────────────────
document.getElementById('restart-btn').addEventListener('click', async () => {
  const btn = document.getElementById('restart-btn');
  if (!confirm('Restart GeorgeBot? It will be offline for a few seconds.')) return;
  btn.disabled = true;
  btn.textContent = 'Restarting…';
  try {
    await api('/api/restart', { method: 'POST' });
    toast('Bot is restarting…');
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Restart GeorgeBot';
      refreshStatus();
    }, 6000);
  } catch {
    toast('Restart failed', true);
    btn.disabled = false;
    btn.textContent = 'Restart GeorgeBot';
  }
});

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await refreshStatus();
  await refreshStats();
  await loadGuilds();
  connectLogs();
  state.statusInterval = setInterval(() => { refreshStatus(); refreshStats(); }, 10_000);
}

init();
