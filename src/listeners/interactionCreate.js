const { commands, handleButton } = require('../commands');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);
        if (!command?.interactionExecute) return;
        await command.interactionExecute(interaction);
      } else if (interaction.isButton()) {
        await handleButton(interaction);
      }
    } catch (err) {
      console.error('Interaction error:', err);
      const msg = { content: 'An error occurred while running that command.', ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        interaction.followUp(msg).catch(() => {});
      } else {
        interaction.reply(msg).catch(() => {});
      }
    }
  },
};
