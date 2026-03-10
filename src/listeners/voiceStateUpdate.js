'use strict';

const { logAction } = require('../webui/logger');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    const member = newState.member ?? oldState.member;
    const tag    = member?.user.tag ?? 'Unknown';
    const guild  = (newState.guild ?? oldState.guild).name;

    if (!oldState.channelId && newState.channelId) {
      logAction('voice', `${tag} joined #${newState.channel.name} in ${guild}`);
    } else if (oldState.channelId && !newState.channelId) {
      logAction('voice', `${tag} left #${oldState.channel.name} in ${guild}`);
    } else if (oldState.channelId !== newState.channelId) {
      logAction('voice', `${tag} moved from #${oldState.channel.name} to #${newState.channel.name} in ${guild}`);
    }
  },
};
