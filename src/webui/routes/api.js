'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { getConfig, updateConfig }   = require('../../util/guildConfig');
const { getQueue, getAllQueues }     = require('../../util/musicQueue');
const { stats, logAction }          = require('../logger');

const ALLOWED_CONFIG_KEYS = ['welcome', 'goodbye', 'autorole'];
const WARN_DIR = path.join(process.cwd(), 'data', 'warnings');

let restartScheduled = false;

module.exports = function apiRouter(client) {
  const router = express.Router();

  // ── Bot status ──────────────────────────────────────────────────────────────
  router.get('/status', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
      online:     client.isReady(),
      tag:        client.user?.tag ?? null,
      avatar:     client.user?.displayAvatarURL({ extension: 'png', size: 128 }) ?? null,
      guildCount: client.guilds.cache.size,
      uptime:     Math.floor(process.uptime()),
      memoryMB:   Math.round(mem.heapUsed  / 1024 / 1024),
      memTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    });
  });

  // ── Stats ───────────────────────────────────────────────────────────────────
  router.get('/stats', (req, res) => {
    const totalMembers = client.guilds.cache.reduce((n, g) => n + g.memberCount, 0);
    const topCmds = Object.entries(stats.commandCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
    res.json({
      totalCommands: stats.totalCommands,
      memberJoins:   stats.memberJoins,
      memberLeaves:  stats.memberLeaves,
      tracksPlayed:  stats.tracksPlayed,
      modActions:    stats.modActions,
      totalMembers,
      topCommands:   topCmds,
    });
  });

  // ── Guilds ──────────────────────────────────────────────────────────────────
  router.get('/guilds', (req, res) => {
    res.json(client.guilds.cache.map(g => ({
      id:          g.id,
      name:        g.name,
      memberCount: g.memberCount,
      icon:        g.iconURL({ extension: 'png', size: 64 }),
    })));
  });

  // ── Channels for a guild (text channels bot can send to) ────────────────────
  router.get('/channels/:guildId', (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const channels = guild.channels.cache
      .filter(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has('SendMessages'))
      .map(c => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(channels);
  });

  // ── Guild config ────────────────────────────────────────────────────────────
  router.get('/guilds/:id/config', (req, res) => {
    res.json(getConfig(req.params.id));
  });

  router.put('/guilds/:id/config', express.json(), (req, res) => {
    const filtered = {};
    for (const key of ALLOWED_CONFIG_KEYS) {
      if (key in req.body) filtered[key] = req.body[key];
    }
    if (!Object.keys(filtered).length) return res.status(400).json({ error: 'No valid keys provided' });
    res.json(updateConfig(req.params.id, filtered));
  });

  // ── Warnings ────────────────────────────────────────────────────────────────
  router.get('/guilds/:id/warnings', (req, res) => {
    const file = path.join(WARN_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(file)) return res.json({});
    try { res.json(JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch { res.json({}); }
  });

  // ── Bot presence ────────────────────────────────────────────────────────────
  router.post('/activity', express.json(), (req, res) => {
    const { type = 'Playing', text = '', status = 'online' } = req.body;
    const typeMap   = { Playing: 0, Listening: 2, Watching: 3, Competing: 5 };
    const validStatus = ['online', 'idle', 'dnd', 'invisible'];
    client.user.setPresence({
      activities: text.trim() ? [{ name: text.trim(), type: typeMap[type] ?? 0 }] : [],
      status:     validStatus.includes(status) ? status : 'online',
    });
    logAction('bot', `[WebUI] Presence set: ${status} — ${type} "${text}"`);
    res.json({ ok: true });
  });

  // ── Announce ────────────────────────────────────────────────────────────────
  router.post('/announce', express.json(), async (req, res) => {
    const { guildId, channelId, message } = req.body;
    if (!guildId || !channelId || !message?.trim())
      return res.status(400).json({ error: 'guildId, channelId, and message are required' });
    const channel = client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
    if (!channel?.isTextBased())
      return res.status(404).json({ error: 'Channel not found or not a text channel' });
    try {
      await channel.send(message.trim());
      logAction('bot', `[WebUI] Announcement sent to #${channel.name} in ${channel.guild.name}`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Music queues ────────────────────────────────────────────────────────────
  router.get('/music', (req, res) => {
    const data = [];
    for (const [guildId, queue] of getAllQueues()) {
      const guild = client.guilds.cache.get(guildId);
      data.push({
        guildId,
        guildName:   guild?.name ?? guildId,
        guildIcon:   guild?.iconURL({ extension: 'png', size: 32 }) ?? null,
        current:     queue.current ?? null,
        queueLength: queue.tracks.length,
        isPaused:    queue.isPaused,
        volume:      queue.volume,
        loop:        queue.loop,
      });
    }
    res.json(data);
  });

  router.post('/music/:guildId/skip', (req, res) => {
    const queue = getQueue(req.params.guildId);
    if (!queue) return res.status(404).json({ error: 'No active queue' });
    const title = queue.current?.title ?? 'track';
    queue.skip();
    logAction('music', `[WebUI] Skipped: ${title} in ${client.guilds.cache.get(req.params.guildId)?.name ?? req.params.guildId}`);
    res.json({ ok: true });
  });

  router.post('/music/:guildId/stop', (req, res) => {
    const queue = getQueue(req.params.guildId);
    if (!queue) return res.status(404).json({ error: 'No active queue' });
    const guild = client.guilds.cache.get(req.params.guildId)?.name ?? req.params.guildId;
    queue.stop();
    logAction('music', `[WebUI] Stopped queue in ${guild}`);
    res.json({ ok: true });
  });

  // ── Restart ─────────────────────────────────────────────────────────────────
  router.post('/restart', (req, res) => {
    if (restartScheduled) return res.json({ ok: true, note: 'already scheduled' });
    restartScheduled = true;
    logAction('bot', '[WebUI] Bot restart triggered');
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 500);
  });

  return router;
};
