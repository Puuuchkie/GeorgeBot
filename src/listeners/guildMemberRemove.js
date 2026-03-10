'use strict';

const { AttachmentBuilder } = require('discord.js');
const { getConfig }         = require('../util/guildConfig');
const { generateCard }      = require('../util/welcomeCard');

function resolve(text, member, guild) {
  return text
    .replace(/{user}/g,        member.user.tag)
    .replace(/{username}/g,    member.user.username)
    .replace(/{server}/g,      guild.name)
    .replace(/{membercount}/g, guild.memberCount);
}

module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    const { guild } = member;
    const config    = getConfig(guild.id);
    const gc        = config.goodbye;
    if (!gc?.channelId) return;

    const channel = guild.channels.cache.get(gc.channelId);
    if (!channel) return;

    try {
      const buf  = await generateCard(member, guild, 'goodbye');
      const file = new AttachmentBuilder(buf, { name: 'goodbye.png' });
      const msg  = gc.message
        ? resolve(gc.message, member, guild)
        : `**${member.user.tag}** has left the server. 👋`;
      await channel.send({ content: msg, files: [file] });
    } catch (err) {
      console.error('Goodbye card error:', err);
    }
  },
};
