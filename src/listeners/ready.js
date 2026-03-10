const { ActivityType } = require('discord.js');
const { LOGIN_MESSAGE } = require('../util/quotes');
const { loadPolls }     = require('../commands');
const { logAction }     = require('../webui/logger');

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    logAction('bot', `Online: ${client.user.tag} — ${client.guilds.cache.size} guild(s)`);
    client.user.setActivity('with your feelings', { type: ActivityType.Playing });
    loadPolls();

    const loginMsg = LOGIN_MESSAGE[Math.floor(Math.random() * LOGIN_MESSAGE.length)];
    for (const guild of client.guilds.cache.values()) {
      const channel = guild.channels.cache
        .filter((c) => c.isTextBased() && c.permissionsFor(guild.members.me)?.has('SendMessages'))
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .first();
      if (channel) channel.send(loginMsg).catch(() => {});
    }
  },
};
