'use strict';

const { commands, handleButton } = require('../commands');
const { logCommand, logAction, stats } = require('../webui/logger');

const MOD_COMMANDS = new Set(['warn', 'timeout', 'ban', 'kick', 'clear']);

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);
        if (!command?.interactionExecute) return;
        logCommand(
          interaction.commandName,
          interaction.user.tag,
          interaction.guild?.name ?? 'DM',
        );
        if (MOD_COMMANDS.has(interaction.commandName)) {
          stats.modActions++;
          logAction('moderation', `${interaction.user.tag} used /${interaction.commandName} in ${interaction.guild?.name ?? 'DM'}`);
        }
        await command.interactionExecute(interaction);
      } else if (interaction.isButton()) {
        logAction('button', `${interaction.user.tag} pressed [${interaction.customId}] in ${interaction.guild?.name ?? 'DM'}`);
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
