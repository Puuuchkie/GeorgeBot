require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const { startWebUI }    = require('./webui/server');
const ready             = require('./listeners/ready');
const voiceStateUpdate  = require('./listeners/voiceStateUpdate');
const interactionCreate = require('./listeners/interactionCreate');
const guildMemberAdd    = require('./listeners/guildMemberAdd');
const guildMemberRemove = require('./listeners/guildMemberRemove');
const messageCreate     = require('./listeners/messageCreate');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,  // privileged — enable in Discord dev portal
  ],
  partials: [Partials.Channel],
});

client.once(ready.name, (c) => ready.execute(c).catch(console.error));

for (const listener of [voiceStateUpdate, interactionCreate, guildMemberAdd, guildMemberRemove, messageCreate]) {
  client.on(listener.name, (...args) => listener.execute(...args).catch(console.error));
}

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN in environment.');
  process.exit(1);
}

client.login(token);
startWebUI(client);
