const { PREFIX } = require('../util/constants');
const { handle } = require('../core/commandHandler');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const body = message.content.slice(PREFIX.length).trim();

    // Support multi-word commands like "whats up"
    let commandName;
    let args;

    if (body.toLowerCase().startsWith('whats up')) {
      commandName = 'whats up';
      args = body.slice('whats up'.length).trim().split(/\s+/).filter(Boolean);
    } else {
      const parts = body.split(/\s+/);
      commandName = parts[0].toLowerCase();
      args = parts.slice(1);
    }

    await handle(commandName, args, message);
  },
};
