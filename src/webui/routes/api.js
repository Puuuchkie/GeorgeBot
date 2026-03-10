'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { getConfig, updateConfig } = require('../../util/guildConfig');
const { stats } = require('../logger');

const ALLOWED_CONFIG_KEYS = ['welcome', 'goodbye', 'autorole'];
const WARN_DIR = path.join(process.cwd(), 'data', 'warnings');

let restartScheduled = false;

module.exports = function apiRouter(client) {
  const router = express.Router();

  // Bot status
  router.get('/status', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
      online:      client.isReady(),
      tag:         client.user?.tag ?? null,
      avatar:      client.user?.displayAvatarURL({ extension: 'png', size: 128 }) ?? null,
      guildCount:  client.guilds.cache.size,
      uptime:      Math.floor(process.uptime()),
      memoryMB:    Math.round(mem.heapUsed / 1024 / 1024),
      memTotalMB:  Math.round(mem.heapTotal / 1024 / 1024),
    });
  });

  // Extended stats
  router.get('/stats', (req, res) => {
    const totalMembers = client.guilds.cache.reduce((n, g) => n + g.memberCount, 0);
    const voiceConns   = client.voice?.adapters?.size ?? 0;
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
      voiceConns,
      topCommands:   topCmds,
    });
  });

  // Guild list
  router.get('/guilds', (req, res) => {
    const guilds = client.guilds.cache.map(g => ({
      id:          g.id,
      name:        g.name,
      memberCount: g.memberCount,
      icon:        g.iconURL({ extension: 'png', size: 64 }),
    }));
    res.json(guilds);
  });

  // Guild config GET
  router.get('/guilds/:id/config', (req, res) => {
    res.json(getConfig(req.params.id));
  });

  // Guild config PUT (whitelist top-level keys)
  router.put('/guilds/:id/config', express.json(), (req, res) => {
    const body = req.body;
    const filtered = {};
    for (const key of ALLOWED_CONFIG_KEYS) {
      if (key in body) filtered[key] = body[key];
    }
    if (!Object.keys(filtered).length) return res.status(400).json({ error: 'No valid keys provided' });
    res.json(updateConfig(req.params.id, filtered));
  });

  // Warnings
  router.get('/guilds/:id/warnings', (req, res) => {
    const file = path.join(WARN_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(file)) return res.json({});
    try { res.json(JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch { res.json({}); }
  });

  // Restart
  router.post('/restart', (req, res) => {
    if (restartScheduled) return res.json({ ok: true, note: 'already scheduled' });
    restartScheduled = true;
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 500);
  });

  return router;
};
