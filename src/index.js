require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const messageCreate = require('./listeners/messageCreate');
const ready = require('./listeners/ready');
const voiceStateUpdate = require('./listeners/voiceStateUpdate');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// Register listeners
client.once(ready.name, (c) => ready.execute(c).catch(console.error));

for (const listener of [messageCreate, voiceStateUpdate]) {
  client.on(listener.name, (...args) => listener.execute(...args).catch(console.error));
}

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN in environment. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

client.login(token);
