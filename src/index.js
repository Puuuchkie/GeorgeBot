require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const ready             = require('./listeners/ready');
const voiceStateUpdate  = require('./listeners/voiceStateUpdate');
const interactionCreate = require('./listeners/interactionCreate');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

// Register listeners
client.once(ready.name, (c) => ready.execute(c).catch(console.error));

for (const listener of [voiceStateUpdate, interactionCreate]) {
  client.on(listener.name, (...args) => listener.execute(...args).catch(console.error));
}

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN in environment. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

client.login(token);
