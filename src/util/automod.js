'use strict';

const { getConfig } = require('./guildConfig');

// In-memory spam tracking: guildId -> userId -> { timestamps, lastContent, dupeCount }
const _spamMap = new Map();

const SPAM_LIMIT  = 5;     // messages
const SPAM_WINDOW = 3_000; // ms
const DUPE_LIMIT  = 3;     // identical messages in a row

function _getTrack(guildId, userId) {
  if (!_spamMap.has(guildId)) _spamMap.set(guildId, new Map());
  const gmap = _spamMap.get(guildId);
  if (!gmap.has(userId)) gmap.set(userId, { timestamps: [], lastContent: '', dupeCount: 0 });
  return gmap.get(userId);
}

/**
 * Check a message against the guild's automod rules.
 * Returns null if clean, or { type, detail } on violation.
 */
function checkMessage(message) {
  const config  = getConfig(message.guildId);
  const automod = config.automod ?? {};
  const content = message.content ?? '';
  const lower   = content.toLowerCase();

  // ── Banned words ──────────────────────────────────────────────────────────
  for (const word of (automod.bannedWords ?? [])) {
    if (word && lower.includes(word.toLowerCase())) {
      return { type: 'profanity', detail: word };
    }
  }

  // ── Discord invite links ───────────────────────────────────────────────────
  if (automod.blockInvites && /discord\.(gg|com\/invite)\/\w+/i.test(content)) {
    return { type: 'invite', detail: null };
  }

  // ── Mass mentions ─────────────────────────────────────────────────────────
  const mentionLimit = automod.mentionLimit ?? 5;
  const mentionCount = message.mentions.users.size + message.mentions.roles.size;
  if (mentionCount > mentionLimit) {
    return { type: 'mentions', detail: mentionCount };
  }

  // ── Spam (rate + duplicate) ───────────────────────────────────────────────
  if (automod.antiSpam !== false) {
    const track = _getTrack(message.guildId, message.author.id);
    const now   = Date.now();

    track.timestamps = track.timestamps.filter(t => now - t < SPAM_WINDOW);
    track.timestamps.push(now);

    if (track.timestamps.length >= SPAM_LIMIT) {
      track.timestamps = [];
      return { type: 'spam', detail: null };
    }

    if (content && content === track.lastContent) {
      track.dupeCount++;
      if (track.dupeCount >= DUPE_LIMIT) {
        track.dupeCount = 0;
        return { type: 'duplicate', detail: null };
      }
    } else {
      track.dupeCount  = 1;
      track.lastContent = content;
    }
  }

  return null;
}

const VIOLATION_TEXT = {
  profanity: (d)  => `Used a banned word: \`${d}\``,
  invite:    ()   => 'Posted a Discord invite link',
  spam:      ()   => 'Sending messages too quickly',
  duplicate: ()   => 'Sending duplicate messages',
  mentions:  (d)  => `Too many mentions (${d})`,
};

function violationReason(v) {
  return (VIOLATION_TEXT[v.type] ?? (() => v.type))(v.detail);
}

module.exports = { checkMessage, violationReason };
