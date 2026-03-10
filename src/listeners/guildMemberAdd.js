'use strict';

const { AttachmentBuilder } = require('discord.js');
const { getConfig }         = require('../util/guildConfig');
const { generateCard }      = require('../util/welcomeCard');

function resolve(text, member, guild) {
  return text
    .replace(/{user}/g,        `${member}`)
    .replace(/{username}/g,    member.user.username)
    .replace(/{server}/g,      guild.name)
    .replace(/{membercount}/g, guild.memberCount);
}

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    const { guild } = member;
    const config    = getConfig(guild.id);

    // Auto-role
    if (config.autorole) {
      const role = guild.roles.cache.get(config.autorole);
      if (role) await member.roles.add(role).catch(() => {});
    }

    // Welcome channel card
    const wc = config.welcome;
    if (wc?.channelId) {
      const channel = guild.channels.cache.get(wc.channelId);
      if (channel) {
        try {
          const buf  = await generateCard(member, guild, 'welcome');
          const file = new AttachmentBuilder(buf, { name: 'welcome.png' });
          const msg  = wc.message
            ? resolve(wc.message, member, guild)
            : `Welcome to **${guild.name}**, ${member}! 🎉`;
          await channel.send({ content: msg, files: [file] });
        } catch (err) {
          console.error('Welcome card error:', err);
        }
      }
    }

    // DM welcome
    if (wc?.dm) {
      const msg = wc.dmMessage
        ? resolve(wc.dmMessage, member, guild)
        : `👋 Welcome to **${guild.name}**! We're glad to have you here.`;
      member.user.send(msg).catch(() => {});
    }
  },
};
