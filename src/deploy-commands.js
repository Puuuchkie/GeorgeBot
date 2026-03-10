require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { COMMAND_LIST } = require('./commands');

const token    = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId  = process.env.GUILD_ID;

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const slashCommands = COMMAND_LIST
  .filter((cmd) => cmd.slashData)
  .map((cmd) => cmd.slashData.toJSON());

const rest = new REST().setToken(token);

(async () => {
  if (guildId) {
    console.log(`Registering ${slashCommands.length} slash commands to guild ${guildId} (instant)...`);
    try {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: slashCommands });
      console.log('✅ Guild commands registered successfully.');
    } catch (err) {
      console.error('Failed to register guild commands:', err);
    }
  } else {
    console.log(`Registering ${slashCommands.length} slash commands globally...`);
    try {
      await rest.put(Routes.applicationCommands(clientId), { body: slashCommands });
      console.log('✅ Global commands registered successfully.');
      console.log('Note: Global commands can take up to 1 hour to appear in all servers.');
    } catch (err) {
      console.error('Failed to register slash commands:', err);
    }
  }
})();
