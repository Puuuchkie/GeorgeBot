'use strict';

const fs   = require('fs');
const path = require('path');

const XP_DIR     = path.join(process.cwd(), 'data', 'xp');
const COOLDOWN   = 60_000; // 1 min between XP awards
const XP_MIN     = 15;
const XP_MAX     = 25;

// Level formula: level = floor(sqrt(xp / 100))
// Level 1 = 100xp, Level 5 = 2500xp, Level 10 = 10000xp
function xpToLevel(xp)   { return Math.floor(Math.sqrt(xp / 100)); }
function levelFloorXp(l) { return l * l * 100; }           // total XP at start of level l
function levelCeilXp(l)  { return (l + 1) * (l + 1) * 100; } // total XP needed to reach level l+1

function loadGuild(guildId) {
  const file = path.join(XP_DIR, `${guildId}.json`);
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function saveGuild(guildId, data) {
  if (!fs.existsSync(XP_DIR)) fs.mkdirSync(XP_DIR, { recursive: true });
  fs.writeFileSync(path.join(XP_DIR, `${guildId}.json`), JSON.stringify(data));
}

/** Award XP for a message. Returns null if on cooldown, else { levelUp, newLevel, xp } */
function awardXp(guildId, userId) {
  const data = loadGuild(guildId);
  const user = data[userId] ?? { xp: 0, lastMsg: 0 };

  if (Date.now() - user.lastMsg < COOLDOWN) return null;

  const earned   = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;
  const oldLevel = xpToLevel(user.xp);
  user.xp       += earned;
  user.lastMsg   = Date.now();
  const newLevel = xpToLevel(user.xp);

  data[userId] = user;
  saveGuild(guildId, data);
  return { levelUp: newLevel > oldLevel, newLevel, xp: user.xp };
}

/** Full rank info for one user in a guild */
function getRank(guildId, userId) {
  const data   = loadGuild(guildId);
  const user   = data[userId] ?? { xp: 0 };
  const xp     = user.xp;
  const level  = xpToLevel(xp);
  const floor  = levelFloorXp(level);
  const ceil   = levelCeilXp(level);
  const sorted = Object.entries(data).sort((a, b) => b[1].xp - a[1].xp);
  const rank   = sorted.findIndex(([id]) => id === userId) + 1;

  return {
    xp,
    level,
    rank:     rank || sorted.length + 1,
    total:    sorted.length,
    progress: xp - floor,
    needed:   ceil - floor,
  };
}

/** Top N users by XP */
function getLeaderboard(guildId, limit = 10) {
  const data = loadGuild(guildId);
  return Object.entries(data)
    .sort((a, b) => b[1].xp - a[1].xp)
    .slice(0, limit)
    .map(([userId, d], i) => ({
      userId,
      rank:  i + 1,
      xp:    d.xp,
      level: xpToLevel(d.xp),
    }));
}

module.exports = { awardXp, getRank, getLeaderboard, xpToLevel, levelFloorXp, levelCeilXp };
