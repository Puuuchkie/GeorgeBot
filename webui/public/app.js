'use strict';

// ── State ──────────────────────────────────────
const state = {
  ws:            null,
  selectedGuild: null,
  statusInterval: null,
};

// ── Utilities ──────────────────────────────────
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

// ── Navigation ─────────────────────────────────
function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
  document.getElementById(`section-${name}`).classList.add('active');
  document.querySelector(`[data-section="${name}"]`).classList.add('active');
}

document.querySelectorAll('.nav-link').forEach(a => {
  a.addEventListener('click', () => showSection(a.dataset.section));
});

// ── Logout ─────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.href = '/login';
});

// ── Status polling ─────────────────────────────
async function refreshStatus() {
  try {
    const res  = await api('/api/status');
    const data = await res.json();

    const dot   = document.getElementById('status-dot');
    const stTxt = document.getElementById('status-text');
    dot.className  = 'dot ' + (data.online ? 'online' : 'offline');
    stTxt.textContent = data.online ? 'Online' : 'Offline';

    if (data.avatar) document.getElementById('bot-avatar').src = data.avatar;
    if (data.tag)    document.getElementById('bot-tag').textContent = data.tag;

    document.getElementById('card-status').textContent  = data.online ? 'Online' : 'Offline';
    document.getElementById('card-status').style.color  = data.online ? 'var(--green)' : 'var(--red)';
    document.getElementById('card-guilds').textContent  = data.guildCount;
    document.getElementById('card-uptime').textContent  = fmtUptime(data.uptime);
    document.getElementById('card-uptime-sub').textContent = `${data.uptime}s total`;
    document.getElementById('card-memory').textContent  = `${data.memoryMB} MB`;
    document.getElementById('card-memory-sub').textContent = `of ${data.memTotalMB} MB heap`;
  } catch {}
}

// ── Guild list ─────────────────────────────────
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

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Guild config panel ─────────────────────────
async function openGuildConfig(guild) {
  state.selectedGuild = guild;
  const panel = document.getElementById('config-panel');
  panel.classList.add('open');

  const title = document.getElementById('config-title');
  title.innerHTML = `<img src="${guild.icon || '/icon.png'}" onerror="this.src='/icon.png'" alt="">${escHtml(guild.name)}`;

  // Reset to Welcome tab
  switchTab('welcome');

  const res    = await api(`/api/guilds/${guild.id}/config`);
  const config = await res.json();

  // Welcome
  document.getElementById('wc-channel').value = config.welcome?.channelId || '';
  document.getElementById('wc-message').value = config.welcome?.message  || '';
  document.getElementById('wc-dm').checked    = !!config.welcome?.dm;
  document.getElementById('wc-dmmsg').value   = config.welcome?.dmMessage || '';

  // Goodbye
  document.getElementById('gb-channel').value = config.goodbye?.channelId || '';
  document.getElementById('gb-message').value = config.goodbye?.message  || '';

  // Autorole
  document.getElementById('ar-role').value = config.autorole || '';

  // Scroll to panel
  panel.scrollIntoView({ behavior: 'smooth' });

  // Warnings loaded on tab switch
}

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'warnings' && state.selectedGuild) loadWarnings(state.selectedGuild.id);
}

// ── Save handlers ──────────────────────────────
document.getElementById('save-welcome').addEventListener('click', async () => {
  if (!state.selectedGuild) return;
  const body = {
    welcome: {
      channelId: document.getElementById('wc-channel').value.trim(),
      message:   document.getElementById('wc-message').value.trim(),
      dm:        document.getElementById('wc-dm').checked,
      dmMessage: document.getElementById('wc-dmmsg').value.trim(),
    },
  };
  await saveConfig(body);
});

document.getElementById('save-goodbye').addEventListener('click', async () => {
  if (!state.selectedGuild) return;
  const body = {
    goodbye: {
      channelId: document.getElementById('gb-channel').value.trim(),
      message:   document.getElementById('gb-message').value.trim(),
    },
  };
  await saveConfig(body);
});

document.getElementById('save-autorole').addEventListener('click', async () => {
  if (!state.selectedGuild) return;
  const body = { autorole: document.getElementById('ar-role').value.trim() || null };
  await saveConfig(body);
});

async function saveConfig(body) {
  try {
    const res = await api(`/api/guilds/${state.selectedGuild.id}/config`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (res.ok) toast('Saved!');
    else        toast('Save failed', true);
  } catch { toast('Save failed', true); }
}

// ── Warnings ────────────────────────────────────
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
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch {
    container.innerHTML = '<p style="color:var(--red)">Failed to load warnings.</p>';
  }
}

// ── Live logs ──────────────────────────────────
const LOG_MAX_NODES = 1000;

function appendLog(entry, container) {
  const line = document.createElement('span');
  line.className = `log-line ${entry.level}`;
  const ts = new Date(entry.ts).toLocaleTimeString();
  line.innerHTML = `<span class="log-ts">${ts}</span>${escHtml(entry.msg)}`;
  container.appendChild(line);
  container.appendChild(document.createTextNode('\n'));

  // Trim old nodes
  while (container.childNodes.length > LOG_MAX_NODES * 2) {
    container.removeChild(container.firstChild);
  }

  // Auto-scroll if near bottom
  const threshold = 80;
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  if (nearBottom) container.scrollTop = container.scrollHeight;
}

function connectLogs() {
  if (state.ws) state.ws.close();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws/logs`);
  state.ws = ws;

  ws.onmessage = e => {
    const entry = JSON.parse(e.data);
    appendLog(entry, document.getElementById('log-output'));
    appendLog(entry, document.getElementById('log-output-full'));
  };

  ws.onclose = () => setTimeout(connectLogs, 3000);
  ws.onerror = () => ws.close();
}

// ── Restart ─────────────────────────────────────
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

// ── Init ────────────────────────────────────────
async function init() {
  await refreshStatus();
  await loadGuilds();
  connectLogs();
  state.statusInterval = setInterval(refreshStatus, 10_000);
}

init();
