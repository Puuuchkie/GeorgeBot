'use strict';

const fs   = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(process.cwd(), 'data', 'guilds');

function getConfig(guildId) {
  const file = path.join(CONFIG_DIR, `${guildId}.json`);
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}

function saveConfig(guildId, config) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(CONFIG_DIR, `${guildId}.json`), JSON.stringify(config, null, 2));
}

function updateConfig(guildId, updates) {
  const config = { ...getConfig(guildId), ...updates };
  saveConfig(guildId, config);
  return config;
}

module.exports = { getConfig, saveConfig, updateConfig };
