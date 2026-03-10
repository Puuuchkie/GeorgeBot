module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    const member = newState.member ?? oldState.member;
    const tag = member?.user.tag ?? 'Unknown';

    if (!oldState.channelId && newState.channelId) {
      // Joined a voice channel
      console.log(`[Voice] ${tag} joined #${newState.channel.name} in ${newState.guild.name}`);
    } else if (oldState.channelId && !newState.channelId) {
      // Left a voice channel
      console.log(`[Voice] ${tag} left #${oldState.channel.name} in ${oldState.guild.name}`);
    } else if (oldState.channelId !== newState.channelId) {
      // Moved between voice channels
      console.log(
        `[Voice] ${tag} moved from #${oldState.channel.name} to #${newState.channel.name} in ${newState.guild.name}`
      );
    }
  },
};
