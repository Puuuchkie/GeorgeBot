'use strict';

const { EmbedBuilder }           = require('discord.js');
const { checkMessage, violationReason } = require('../util/automod');
const { awardXp }                = require('../util/xpManager');
const { getConfig }              = require('../util/guildConfig');
const { logAction, stats }       = require('../webui/logger');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot || !message.guild) return;

    // ── AutoMod ───────────────────────────────────────────────────────────────
    const config  = getConfig(message.guildId);
    const automod = config.automod ?? {};

    if (automod.enabled !== false) {
      const violation = checkMessage(message);
      if (violation) {
        const reason = violationReason(violation);
        await message.delete().catch(() => {});

        // Warn in channel (auto-deletes after 6s)
        const warn = await message.channel.send({
          embeds: [new EmbedBuilder()
            .setColor(0xf04747)
            .setDescription(`⚠️ ${message.author} — ${reason}`)],
        }).catch(() => null);
        if (warn) setTimeout(() => warn.delete().catch(() => {}), 6_000);

        logAction('moderation', `[AutoMod] ${message.author.tag} in #${message.channel.name} (${message.guild.name}): ${reason}`);
        stats.modActions++;
        return; // No XP for deleted messages
      }
    }

    // ── XP ────────────────────────────────────────────────────────────────────
    if (config.xp?.enabled !== false) {
      const result = awardXp(message.guildId, message.author.id);
      if (result?.levelUp) {
        const lvlCh = config.xp?.channelId
          ? message.guild.channels.cache.get(config.xp.channelId)
          : message.channel;
        if (lvlCh?.isTextBased()) {
          lvlCh.send({
            embeds: [new EmbedBuilder()
              .setColor(0x5865f2)
              .setDescription(`🎉 ${message.author} leveled up to **Level ${result.newLevel}**!`)],
          }).catch(() => {});
        }
        logAction('bot', `${message.author.tag} → Level ${result.newLevel} in ${message.guild.name}`);
      }
    }
  },
};
