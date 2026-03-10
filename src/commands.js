'use strict';

const {
  EmbedBuilder, SlashCommandBuilder,
  ButtonBuilder, ButtonStyle, ActionRowBuilder,
} = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const { VERSION } = require('./util/constants');
const { ANSWERS, JOKES, FOOD } = require('./util/quotes');
const { checkPerms, getPermLevel } = require('./core/permsCore');
const { getConfig, updateConfig } = require('./util/guildConfig');
const { generateCard } = require('./util/welcomeCard');
const { MusicQueue, getQueue, setQueue } = require('./util/musicQueue');

// ─── Music service helpers ────────────────────────────────────────────────────

let _spotifyReady = false;

async function ensureSpotify(playdl) {
  if (_spotifyReady || !process.env.SPOTIFY_CLIENT_ID) return;
  await playdl.setToken({
    spotify: {
      client_id:     process.env.SPOTIFY_CLIENT_ID,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET || '',
      refresh_token: '',
      access_token:  '',
    },
  });
  _spotifyReady = true;
}

async function resolveAppleMusic(url) {
  const trackMatch = url.match(/[?&]i=(\d+)/);
  const idMatch    = url.match(/\/(\d+)(?:[?#]|$)/);
  const isAlbum    = url.includes('/album/') && !trackMatch;

  if (trackMatch) {
    const res  = await fetch(`https://itunes.apple.com/lookup?id=${trackMatch[1]}`);
    const data = await res.json();
    const item = data.results?.[0];
    if (!item) return null;
    return [{ search: `${item.trackName} ${item.artistName}`, title: `${item.trackName} — ${item.artistName}` }];
  }

  if (isAlbum && idMatch) {
    const res    = await fetch(`https://itunes.apple.com/lookup?id=${idMatch[1]}&entity=song`);
    const data   = await res.json();
    const tracks = data.results?.filter(r => r.wrapperType === 'track') ?? [];
    return tracks.map(t => ({ search: `${t.trackName} ${t.artistName}`, title: `${t.trackName} — ${t.artistName}` }));
  }

  return null;
}

// ─── Vote persistence ────────────────────────────────────────────────────────

const VOTE_DIR = path.join(process.cwd(), 'data', 'votes');
const polls = new Map(); // guildId -> poll object

function ensureVoteDir() {
  if (!fs.existsSync(VOTE_DIR)) fs.mkdirSync(VOTE_DIR, { recursive: true });
}

function savePoll(guildId) {
  ensureVoteDir();
  const file = path.join(VOTE_DIR, `${guildId}.json`);
  const poll = polls.get(guildId);
  if (!poll) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } else {
    fs.writeFileSync(file, JSON.stringify(poll));
  }
}

function loadPolls() {
  if (!fs.existsSync(VOTE_DIR)) return;
  for (const file of fs.readdirSync(VOTE_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(VOTE_DIR, file), 'utf8'));
      polls.set(file.replace('.json', ''), data);
    } catch {
      console.warn(`Failed to load vote data: ${file}`);
    }
  }
}

const VOTE_EMOJIS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

// ─── Warnings persistence ─────────────────────────────────────────────────────

const WARN_DIR = path.join(process.cwd(), 'data', 'warnings');

function getWarnings(guildId, userId) {
  const file = path.join(WARN_DIR, `${guildId}.json`);
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).filter((w) => w.userId === userId); }
  catch { return []; }
}

function addWarning(guildId, entry) {
  if (!fs.existsSync(WARN_DIR)) fs.mkdirSync(WARN_DIR, { recursive: true });
  const file = path.join(WARN_DIR, `${guildId}.json`);
  let all = [];
  if (fs.existsSync(file)) { try { all = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} }
  all.push(entry);
  fs.writeFileSync(file, JSON.stringify(all));
}

// ─── Time parser (for remindme / timeout) ─────────────────────────────────────

function parseTime(str) {
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const units = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return parseInt(match[1]) * units[match[2].toLowerCase()];
}

function buildPollEmbed(poll, guild, disabled = false) {
  const creator = guild.members.cache.get(poll.creatorId);
  const lines = poll.answers.map((a, i) => {
    const count = Object.values(poll.votes).filter((v) => v === i + 1).length;
    return `${VOTE_EMOJIS[i]} ${a} — **${count}** vote(s)`;
  });
  return new EmbedBuilder()
    .setAuthor({ name: `${creator?.displayName ?? 'Unknown'}'s poll`, iconURL: creator?.user.displayAvatarURL() })
    .setDescription(`✏️ **${poll.heading}**\n\n${lines.join('\n')}`)
    .setFooter({ text: disabled ? 'Poll closed.' : 'Click a button below to vote!' })
    .setColor(disabled ? 0x888888 : 0x00bcd4);
}

function voteRows(poll, guildId, disabled = false) {
  const buttons = poll.answers.map((answer, i) =>
    new ButtonBuilder()
      .setCustomId(`vote:${guildId}:${i}`)
      .setLabel(answer.length > 75 ? answer.slice(0, 72) + '...' : answer)
      .setEmoji(VOTE_EMOJIS[i])
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5)
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  return rows;
}

function errReply(interaction, text) {
  return interaction.reply({ embeds: [new EmbedBuilder().setDescription(text).setColor(0xff0000)], ephemeral: true });
}

// ─── Weather helpers ─────────────────────────────────────────────────────────

const WEATHER_ICONS = {
  sunny: '☀️', clear: '🌙', cloud: '☁️', overcast: '☁️',
  rain: '🌧️', drizzle: '🌦️', snow: '❄️', sleet: '🌨️',
  thunder: '⛈️', fog: '🌫️', mist: '🌫️', blizzard: '🌨️', wind: '💨',
};

function weatherIcon(desc) {
  const lower = desc.toLowerCase();
  for (const [k, v] of Object.entries(WEATHER_ICONS)) if (lower.includes(k)) return v;
  return '🌡️';
}

async function fetchWeatherEmbed(city) {
  const res = await fetch(
    `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
    { headers: { 'User-Agent': 'GeorgeBot/1.0' } }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const cur  = data.current_condition[0];
  const area = data.nearest_area[0];
  const location = [area.areaName[0]?.value, area.region[0]?.value, area.country[0]?.value]
    .filter(Boolean).join(', ');
  const condition = cur.weatherDesc[0]?.value ?? 'Unknown';
  return new EmbedBuilder()
    .setTitle(`${weatherIcon(condition)} Weather in ${location}`)
    .setColor(0x5865f2)
    .addFields(
      { name: '🌡️ Temperature', value: `${cur.temp_C}°C / ${cur.temp_F}°F`, inline: true },
      { name: '🌤️ Condition',   value: condition,                           inline: true },
      { name: '💧 Humidity',    value: `${cur.humidity}%`,                  inline: true },
      { name: '💨 Wind',        value: `${cur.windspeedKmph} km/h ${cur.winddir16Point}`, inline: true },
      { name: '🔽 Pressure',    value: `${cur.pressure} hPa`,              inline: true },
      { name: '👁️ Visibility', value: `${cur.visibility} km`,             inline: true }
    )
    .setFooter({ text: 'Powered by wttr.in' })
    .setTimestamp();
}

// ─── Uptime helper ────────────────────────────────────────────────────────────

function formatUptime(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60),
        h = Math.floor(m / 60),    d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function buildInfoEmbed(client) {
  return new EmbedBuilder()
    .setTitle('🤖 George — Bot Info')
    .setThumbnail(client.user.displayAvatarURL())
    .setColor(0x00bcd4)
    .addFields(
      { name: '✅ Status',  value: 'Online and ready!', inline: true },
      { name: '⏱️ Uptime', value: formatUptime(client.uptime), inline: true },
      { name: '📦 Version', value: `v${VERSION}`, inline: true },
      { name: '💡 Tip',    value: 'Use `/commands` to see everything I can do!' }
    )
    .setFooter({ text: `Serving ${client.guilds.cache.size} server(s)` })
    .setTimestamp();
}

// ─── RPS helpers ─────────────────────────────────────────────────────────────

const RPS_CHOICES = ['rock', 'paper', 'scissors'];
const RPS_EMOJI   = { rock: '🪨', paper: '🗞️', scissors: '✂️' };

const RPS_OUTCOME = {
  rock:     { rock: 'draw', paper: 'lose', scissors: 'win' },
  paper:    { rock: 'win',  paper: 'draw', scissors: 'lose' },
  scissors: { rock: 'lose', paper: 'win',  scissors: 'draw' },
};

function rpsResultText(choice) {
  const bot    = RPS_CHOICES[Math.floor(Math.random() * 3)];
  const result = RPS_OUTCOME[choice][bot];
  const lines  = {
    win:  `🎉 You win! ${RPS_EMOJI[choice]} beats ${RPS_EMOJI[bot]}`,
    lose: `😈 I win! ${RPS_EMOJI[bot]} beats ${RPS_EMOJI[choice]}`,
    draw: `🤝 It's a draw! We both chose ${RPS_EMOJI[choice]}`,
  };
  return `You chose ${RPS_EMOJI[choice]} — I chose ${RPS_EMOJI[bot]}\n${lines[result]}`;
}

function rpsRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rps:rock:${userId}`).setLabel('Rock').setEmoji('🪨').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rps:paper:${userId}`).setLabel('Paper').setEmoji('🗞️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rps:scissors:${userId}`).setLabel('Scissors').setEmoji('✂️').setStyle(ButtonStyle.Primary),
  );
}

// ─── Slots & coinflip helpers ─────────────────────────────────────────────────

const SLOT_REELS = ['🍎','🍊','🍋','🍇','🍓','💎','7️⃣'];

function spinSlots() {
  return [0, 1, 2].map(() => SLOT_REELS[Math.floor(Math.random() * SLOT_REELS.length)]);
}

function slotsEmbed(reels) {
  const [a, b, c] = reels;
  let result, color;
  if (a === b && b === c) {
    result = a === '💎' ? '💎 **DIAMOND JACKPOT!** 💎' : a === '7️⃣' ? '7️⃣ **LUCKY SEVENS!** 7️⃣' : `🎊 **JACKPOT! ${a}${b}${c}**`;
    color = 0xffd700;
  } else if (a === b || b === c || a === c) {
    result = '🎉 Two of a kind — small win!';
    color = 0x00c853;
  } else {
    result = '😢 No match. Try again!';
    color = 0x888888;
  }
  return new EmbedBuilder()
    .setTitle('🎰 Slot Machine')
    .setDescription(`[ ${a} | ${b} | ${c} ]\n\n${result}`)
    .setColor(color);
}

function coinflipEmbed() {
  const heads = Math.random() < 0.5;
  return new EmbedBuilder()
    .setTitle('🪙 Coin Flip')
    .setDescription(heads ? '🌟 **Heads!**' : '🌑 **Tails!**')
    .setColor(heads ? 0xffd700 : 0x888888);
}

// ─── Button row helpers ───────────────────────────────────────────────────────

const catRow  = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('cat_new').setLabel('New cat').setEmoji('🐱').setStyle(ButtonStyle.Secondary)
);
const foodRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('food_new').setLabel('Reroll').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
);
const rollRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('roll_new').setLabel('Roll again').setEmoji('🎲').setStyle(ButtonStyle.Secondary)
);
const jokeRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('joke_new').setLabel('Next joke').setEmoji('😂').setStyle(ButtonStyle.Secondary)
);
const coinflipRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('coinflip_new').setLabel('Flip again').setEmoji('🪙').setStyle(ButtonStyle.Secondary)
);
const slotsRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('slots_spin').setLabel('Spin again').setEmoji('🎰').setStyle(ButtonStyle.Secondary)
);
const confirmRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('confirm').setLabel('Confirm').setEmoji('✅').setStyle(ButtonStyle.Danger),
  new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setEmoji('❌').setStyle(ButtonStyle.Secondary)
);

// ─── RIP embed helper ─────────────────────────────────────────────────────────

function buildRipEmbed(targetMember, text) {
  const avatarUrl = targetMember.user.displayAvatarURL({ extension: 'png', size: 256 });
  const ripUrl    = `https://vacefron.nl/api/rip?user=${encodeURIComponent(avatarUrl)}`;
  return new EmbedBuilder()
    .setTitle('⚰️ R.I.P')
    .setDescription(`*${text || `R.I.P ${targetMember.displayName}`}*`)
    .setImage(ripUrl)
    .setColor(0x2c2c2c)
    .setFooter({ text: `Gone but not forgotten — ${targetMember.displayName}` });
}

// ─── Commands embed builder ───────────────────────────────────────────────────

function buildCommandsEmbed(userLevel) {
  const visible = COMMAND_LIST.filter((c) => c.permLevel <= userLevel);
  const grouped = {};
  for (const cmd of visible) {
    if (!grouped[cmd.category]) grouped[cmd.category] = [];
    grouped[cmd.category].push(`\`/${cmd.name}\` — ${cmd.description}`);
  }
  const CATEGORY_EMOJI = { Information: 'ℹ️', Fun: '🎉', Voting: '🗳️', VIP: '⭐', Moderation: '🔨', Setup: '⚙️', Music: '🎵' };
  const embed = new EmbedBuilder()
    .setTitle('📋 Available Commands')
    .setColor(0x5865f2)
    .setFooter({ text: 'All commands are slash commands — type / to get started' });
  for (const [cat, lines] of Object.entries(grouped))
    embed.addFields({ name: `${CATEGORY_EMOJI[cat] ?? '•'} ${cat}`, value: lines.join('\n') });
  return embed;
}

// ─────────────────────────────────────────────────────────────────────────────
//  COMMAND LIST
//  permLevel: 0 = everyone | 1 = Member+ | 2 = Moderator/Owner
// ─────────────────────────────────────────────────────────────────────────────

const COMMAND_LIST = [

  // ── Information ─────────────────────────────────────────────────────────────

  {
    name: 'commands',
    category: 'Information',
    description: 'Shows all commands available to you',
    permLevel: 0,
    slashData: new SlashCommandBuilder()
      .setName('commands').setDescription('Shows all commands available to you'),
    async interactionExecute(interaction) {
      await interaction.reply({ embeds: [buildCommandsEmbed(getPermLevel(interaction.member))], ephemeral: true });
    },
  },

  {
    name: 'info',
    category: 'Information',
    description: 'Shows bot status, uptime and version',
    permLevel: 0,
    slashData: new SlashCommandBuilder()
      .setName('info').setDescription('Shows bot status, uptime and version'),
    async interactionExecute(interaction) {
      await interaction.reply({ embeds: [buildInfoEmbed(interaction.client)], ephemeral: true });
    },
  },

  {
    name: 'weather',
    category: 'Information',
    description: 'Shows current weather for a city',
    permLevel: 0,
    slashData: new SlashCommandBuilder()
      .setName('weather').setDescription('Shows current weather for a city')
      .addStringOption((o) => o.setName('city').setDescription('City name').setRequired(true)),
    async interactionExecute(interaction) {
      const city = interaction.options.getString('city');
      await interaction.deferReply();
      try {
        await interaction.editReply({ embeds: [await fetchWeatherEmbed(city)] });
      } catch {
        await interaction.editReply(`Could not fetch weather for **${city}**. Check the city name and try again.`);
      }
    },
  },

  {
    name: 'serverinfo',
    category: 'Information',
    description: 'Shows stats and info about this server',
    permLevel: 0,
    slashData: new SlashCommandBuilder()
      .setName('serverinfo').setDescription('Shows stats and info about this server'),
    async interactionExecute(interaction) {
      const { guild } = interaction;
      await guild.fetch();
      const owner = await guild.fetchOwner();
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle(`📊 ${guild.name}`)
          .setThumbnail(guild.iconURL({ size: 256 }))
          .setColor(0x5865f2)
          .addFields(
            { name: '👑 Owner',        value: owner.user.tag,                                                         inline: true },
            { name: '👥 Members',      value: `${guild.memberCount}`,                                                 inline: true },
            { name: '📅 Created',      value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,                   inline: true },
            { name: '💬 Channels',     value: `${guild.channels.cache.size}`,                                         inline: true },
            { name: '🎭 Roles',        value: `${guild.roles.cache.size}`,                                            inline: true },
            { name: '✨ Boost Level',  value: `Level ${guild.premiumTier} (${guild.premiumSubscriptionCount} boosts)`, inline: true },
          )
          .setFooter({ text: `ID: ${guild.id}` })
          .setTimestamp()],
      });
    },
  },

  {
    name: 'remindme',
    category: 'Information',
    description: 'DMs you a reminder after a set time (e.g. 10m, 2h, 1d)',
    permLevel: 0,
    slashData: new SlashCommandBuilder()
      .setName('remindme').setDescription('DMs you a reminder after a set time')
      .addStringOption((o) => o.setName('time').setDescription('Duration e.g. 10m, 2h, 1d').setRequired(true))
      .addStringOption((o) => o.setName('message').setDescription('What to remind you about').setRequired(true)),
    async interactionExecute(interaction) {
      const timeStr = interaction.options.getString('time');
      const message = interaction.options.getString('message');
      const ms = parseTime(timeStr);
      if (!ms) return errReply(interaction, 'Invalid time format. Use `10s`, `5m`, `2h`, or `1d`.');
      if (ms > 7 * 86_400_000) return errReply(interaction, 'Maximum reminder time is **7 days**.');
      await interaction.reply({ content: `✅ I'll remind you about **"${message}"** in **${timeStr}**!`, ephemeral: true });
      setTimeout(async () => {
        try {
          await interaction.user.send(`⏰ **Reminder:** ${message}`);
        } catch {
          interaction.channel?.send(`⏰ ${interaction.user}, reminder: **${message}**`).catch(() => {});
        }
      }, ms);
    },
  },

  {
    name: 'avatar',
    category: 'Information',
    description: "Displays your avatar or another member's",
    permLevel: 0,
    slashData: new SlashCommandBuilder()
      .setName('avatar').setDescription("Displays your avatar or another member's")
      .addUserOption((o) => o.setName('user').setDescription('Member to show avatar for')),
    async interactionExecute(interaction) {
      const target = interaction.options.getUser('user') ?? interaction.user;
      await interaction.reply({
        embeds: [new EmbedBuilder().setTitle(`🖼️ ${target.username}'s avatar`).setImage(target.displayAvatarURL({ size: 512 })).setColor(0x5865f2)],
      });
    },
  },

  // ── Fun ──────────────────────────────────────────────────────────────────────

  {
    name: 'ping',
    category: 'Fun',
    description: 'Returns Pong! 🏓',
    permLevel: 0,
    slashData: new SlashCommandBuilder().setName('ping').setDescription('Returns Pong! 🏓'),
    async interactionExecute(interaction) {
      await interaction.reply('Pong! 🏓');
    },
  },

  {
    name: 'sup',
    category: 'Fun',
    description: "Ask George what's up",
    permLevel: 0,
    slashData: new SlashCommandBuilder().setName('sup').setDescription("Ask George what's up"),
    async interactionExecute(interaction) {
      await interaction.reply(ANSWERS[Math.floor(Math.random() * ANSWERS.length)]);
    },
  },

  {
    name: 'cat',
    category: 'Fun',
    description: 'Sends a random cat image 🐱',
    permLevel: 0,
    slashData: new SlashCommandBuilder().setName('cat').setDescription('Sends a random cat image 🐱'),
    async interactionExecute(interaction) {
      await interaction.deferReply();
      try {
        const url = await fetchCatUrl();
        await interaction.editReply({ embeds: [catEmbed(url)], components: [catRow()] });
      } catch {
        await interaction.editReply('Could not fetch a cat image right now. Try again later!');
      }
    },
  },

  {
    name: 'roll',
    category: 'Fun',
    description: 'Rolls a 6-sided dice 🎲',
    permLevel: 0,
    slashData: new SlashCommandBuilder().setName('roll').setDescription('Rolls a 6-sided dice 🎲'),
    async interactionExecute(interaction) {
      await interaction.reply({ content: rollText(), components: [rollRow()] });
    },
  },

  {
    name: 'joke',
    category: 'Fun',
    description: 'Tells a random joke 😂',
    permLevel: 0,
    slashData: new SlashCommandBuilder().setName('joke').setDescription('Tells a random joke 😂'),
    async interactionExecute(interaction) {
      await interaction.reply({ content: `😂 ${JOKES[Math.floor(Math.random() * JOKES.length)]}`, components: [jokeRow()] });
    },
  },

  {
    name: 'ymjoke',
    category: 'Fun',
    description: 'Tells a yo mama joke at a member',
    permLevel: 0,
    slashData: new SlashCommandBuilder()
      .setName('ymjoke').setDescription('Tells a yo mama joke at a member')
      .addUserOption((o) => o.setName('user').setDescription('Member to target').setRequired(true)),
    async interactionExecute(interaction) {
      const target = interaction.options.getUser('user');
      await interaction.deferReply();
      try {
        const res  = await fetch('https://www.yomama-jokes.com/api/v1/jokes/random/');
        const data = await res.json();
        await interaction.editReply(`😂 ${target}, ${data.joke ?? "Yo mama so slow, she's still loading."}`);
      } catch {
        await interaction.editReply('Could not fetch a joke right now. Try again later!');
      }
    },
  },

  {
    name: 'food',
    category: 'Fun',
    description: 'Suggests something to eat 🍔',
    permLevel: 0,
    slashData: new SlashCommandBuilder().setName('food').setDescription('Suggests something to eat 🍔'),
    async interactionExecute(interaction) {
      await interaction.reply({ embeds: [foodEmbed()], components: [foodRow()] });
    },
  },

  {
    name: 'rps',
    category: 'Fun',
    description: 'Play Rock Paper Scissors against George 🪨🗞️✂️',
    permLevel: 0,
    slashData: new SlashCommandBuilder()
      .setName('rps').setDescription('Play Rock Paper Scissors against George'),
    async interactionExecute(interaction) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setDescription('Choose your weapon!').setColor(0x5865f2)],
        components: [rpsRow(interaction.user.id)],
      });
    },
  },

  {
    name: 'coinflip',
    category: 'Fun',
    description: 'Flip a coin 🪙',
    permLevel: 0,
    slashData: new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin 🪙'),
    async interactionExecute(interaction) {
      await interaction.reply({ embeds: [coinflipEmbed()], components: [coinflipRow()] });
    },
  },

  {
    name: 'slots',
    category: 'Fun',
    description: 'Spin the slot machine 🎰',
    permLevel: 0,
    slashData: new SlashCommandBuilder().setName('slots').setDescription('Spin the slot machine 🎰'),
    async interactionExecute(interaction) {
      await interaction.reply({ embeds: [slotsEmbed(spinSlots())], components: [slotsRow()] });
    },
  },

  {
    name: 'rip',
    category: 'Fun',
    description: 'Generates a tombstone for a member ⚰️',
    permLevel: 0,
    slashData: new SlashCommandBuilder()
      .setName('rip').setDescription('Generates a tombstone for a member ⚰️')
      .addUserOption((o) => o.setName('user').setDescription('Member to bury').setRequired(true))
      .addStringOption((o) => o.setName('text').setDescription('Tombstone inscription')),
    async interactionExecute(interaction) {
      const target = interaction.options.getMember('user');
      const text   = interaction.options.getString('text') ?? '';
      await interaction.reply({ embeds: [buildRipEmbed(target, text)] });
    },
  },

  // ── Voting ───────────────────────────────────────────────────────────────────

  {
    name: 'vote',
    category: 'Voting',
    description: 'Poll system — subcommands: create, v, stats, close',
    permLevel: 0,
    slashData: new SlashCommandBuilder()
      .setName('vote').setDescription('Poll system')
      .addSubcommand((sub) =>
        sub.setName('create').setDescription('Create a new poll')
          .addStringOption((o) => o.setName('heading').setDescription('Poll question').setRequired(true))
          .addStringOption((o) => o.setName('options').setDescription('Options separated by | (e.g. Yes | No | Maybe)').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName('v').setDescription('Vote on the current poll (or just click the buttons!)')
          .addIntegerOption((o) => o.setName('number').setDescription('Option number').setRequired(true).setMinValue(1))
      )
      .addSubcommand((sub) => sub.setName('stats').setDescription('Show current poll standings'))
      .addSubcommand((sub) => sub.setName('close').setDescription('Close the current poll (creator only)')),
    async interactionExecute(interaction) {
      const { guild, member } = interaction;
      const sub = interaction.options.getSubcommand();

      switch (sub) {

        case 'create': {
          if (polls.has(guild.id)) return errReply(interaction, 'There is already a vote running in this server!');
          const heading = interaction.options.getString('heading');
          const answers = interaction.options.getString('options').split(/\|\s*/).map((a) => a.trim()).filter(Boolean);
          if (answers.length < 2) return errReply(interaction, 'Provide at least 2 options separated by `|`');
          if (answers.length > 10) return errReply(interaction, 'A poll can have a maximum of 10 options.');
          const poll = { creatorId: member.id, heading, answers, votes: {}, channelId: null, messageId: null };
          polls.set(guild.id, poll);
          savePoll(guild.id);
          const msg = await interaction.reply({
            embeds: [buildPollEmbed(poll, guild)],
            components: voteRows(poll, guild.id),
            fetchReply: true,
          });
          poll.channelId = msg.channelId;
          poll.messageId = msg.id;
          savePoll(guild.id);
          break;
        }

        case 'v': {
          if (!polls.has(guild.id)) return errReply(interaction, 'There is no poll running!');
          const poll = polls.get(guild.id);
          const num  = interaction.options.getInteger('number');
          if (num > poll.answers.length) return errReply(interaction, `This poll only has **${poll.answers.length}** options.`);
          if (poll.votes[interaction.user.id] !== undefined)
            return errReply(interaction, 'You can only vote **once** per poll!');
          poll.votes[interaction.user.id] = num;
          savePoll(guild.id);
          await interaction.reply({ content: `✅ Voted for **${poll.answers[num - 1]}**!`, ephemeral: true });
          break;
        }

        case 'stats': {
          if (!polls.has(guild.id)) return errReply(interaction, 'There is no vote running!');
          await interaction.reply({ embeds: [buildPollEmbed(polls.get(guild.id), guild)], components: voteRows(polls.get(guild.id), guild.id) });
          break;
        }

        case 'close': {
          if (!polls.has(guild.id)) return errReply(interaction, 'There is no vote running!');
          const poll = polls.get(guild.id);
          if (poll.creatorId !== member.id) {
            const creator = guild.members.cache.get(poll.creatorId);
            return errReply(interaction, `Only the creator (${creator ?? 'Unknown'}) can close this poll!`);
          }
          polls.delete(guild.id);
          savePoll(guild.id);
          // Disable buttons on original poll message
          if (poll.channelId && poll.messageId) {
            const ch = guild.channels.cache.get(poll.channelId);
            if (ch) {
              const orig = await ch.messages.fetch(poll.messageId).catch(() => null);
              if (orig) await orig.edit({ embeds: [buildPollEmbed(poll, guild, true)], components: voteRows(poll, guild.id, true) }).catch(() => {});
            }
          }
          await interaction.reply({
            embeds: [
              buildPollEmbed(poll, guild, true),
              new EmbedBuilder().setDescription(`Poll closed by ${member}.`).setColor(0xff7000),
            ],
          });
          break;
        }
      }
    },
  },

  // ── VIP ──────────────────────────────────────────────────────────────────────

  {
    name: 'say',
    category: 'VIP',
    description: 'Makes George broadcast a message 📢',
    permLevel: 1,
    slashData: new SlashCommandBuilder()
      .setName('say').setDescription('Makes George broadcast a message 📢')
      .addStringOption((o) => o.setName('text').setDescription('Message to broadcast').setRequired(true)),
    async interactionExecute(interaction) {
      if (!checkPerms(interaction.member, interaction.channel, 1))
        return errReply(interaction, 'You do not have permission to use this command.');
      const text = interaction.options.getString('text');
      await interaction.reply({ content: '✅ Message sent!', ephemeral: true });
      interaction.channel.send(`📢 ${text}`);
    },
  },

  {
    name: 'react',
    category: 'VIP',
    description: 'Reacts to a message with hype emojis',
    permLevel: 1,
    slashData: new SlashCommandBuilder()
      .setName('react').setDescription('Reacts to a message with hype emojis')
      .addStringOption((o) => o.setName('messageid').setDescription('ID of the message to react to').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Number of emojis (1–15)').setRequired(true).setMinValue(1).setMaxValue(15)),
    async interactionExecute(interaction) {
      if (!checkPerms(interaction.member, interaction.channel, 1))
        return errReply(interaction, 'You do not have permission to use this command.');
      const msgId  = interaction.options.getString('messageid');
      const amount = interaction.options.getInteger('amount');
      let target;
      try { target = await interaction.channel.messages.fetch(msgId); }
      catch { return errReply(interaction, "Couldn't find that message in this channel."); }
      await interaction.reply({ content: '✅ Reacting!', ephemeral: true });
      const HYPE = ['❤️','🔥','🍆','💯','😍','👀','🤩','💪','🙌','👌','🎉','⚡','🌶️','💥','😤'];
      const picked = [...HYPE].sort(() => Math.random() - 0.5).slice(0, amount);
      for (const emoji of picked) await target.react(emoji).catch(() => {});
    },
  },

  // ── Moderation ───────────────────────────────────────────────────────────────

  {
    name: 'clear',
    category: 'Moderation',
    description: 'Deletes 2–100 messages from the channel',
    permLevel: 2,
    slashData: new SlashCommandBuilder()
      .setName('clear').setDescription('Deletes messages from the channel')
      .addIntegerOption((o) => o.setName('amount').setDescription('Number of messages to delete (2–100)').setRequired(true).setMinValue(2).setMaxValue(100)),
    async interactionExecute(interaction) {
      if (!checkPerms(interaction.member, interaction.channel, 2))
        return errReply(interaction, 'You do not have permission to use this command.');
      const amount = interaction.options.getInteger('amount');
      const response = await interaction.reply({
        embeds: [new EmbedBuilder().setDescription(`⚠️ Delete **${amount}** messages from this channel?`).setColor(0xff7000)],
        components: [confirmRow()],
        ephemeral: true,
        fetchReply: true,
      });
      try {
        const btn = await response.awaitMessageComponent({ filter: (i) => i.user.id === interaction.user.id, time: 30_000 });
        if (btn.customId === 'confirm') {
          await btn.deferUpdate();
          await interaction.channel.bulkDelete(amount, true).catch(() => {});
          await interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`✅ Deleted **${amount}** messages.`).setColor(0x00c853)], components: [] });
        } else {
          await btn.update({ embeds: [new EmbedBuilder().setDescription('❌ Cancelled.').setColor(0x888888)], components: [] });
        }
      } catch {
        await interaction.editReply({ embeds: [new EmbedBuilder().setDescription('⏱️ Timed out — no action taken.').setColor(0x888888)], components: [] });
      }
    },
  },

  {
    name: 'ban',
    category: 'Moderation',
    description: 'Bans a member 🔨',
    permLevel: 2,
    slashData: new SlashCommandBuilder()
      .setName('ban').setDescription('Bans a member 🔨')
      .addUserOption((o) => o.setName('user').setDescription('Member to ban').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for ban')),
    async interactionExecute(interaction) {
      if (!checkPerms(interaction.member, interaction.channel, 2))
        return errReply(interaction, 'You do not have permission to use this command.');
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      if (!target?.bannable) return errReply(interaction, "I don't have permission to ban that user.");
      const response = await interaction.reply({
        embeds: [new EmbedBuilder().setDescription(`🔨 Ban **${target.user.tag}**?\nReason: ${reason}`).setColor(0xff0000)],
        components: [confirmRow()],
        ephemeral: true,
        fetchReply: true,
      });
      try {
        const btn = await response.awaitMessageComponent({ filter: (i) => i.user.id === interaction.user.id, time: 30_000 });
        if (btn.customId === 'confirm') {
          await target.ban({ reason });
          await btn.update({
            embeds: [new EmbedBuilder().setDescription(`🔨 **${target.user.tag}** has been banned. | ${reason}`).setColor(0xff0000)],
            components: [],
          });
          interaction.channel.send({ embeds: [new EmbedBuilder().setDescription(`🔨 **${target.user.tag}** was banned by ${interaction.member}. | ${reason}`).setColor(0xff0000)] });
        } else {
          await btn.update({ embeds: [new EmbedBuilder().setDescription('❌ Cancelled.').setColor(0x888888)], components: [] });
        }
      } catch {
        await interaction.editReply({ embeds: [new EmbedBuilder().setDescription('⏱️ Timed out — no action taken.').setColor(0x888888)], components: [] });
      }
    },
  },

  {
    name: 'timeout',
    category: 'Moderation',
    description: 'Times out a member for a set duration',
    permLevel: 2,
    slashData: new SlashCommandBuilder()
      .setName('timeout').setDescription('Times out a member')
      .addUserOption((o) => o.setName('user').setDescription('Member to timeout').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('Duration e.g. 10m, 2h, 1d (max 28d)').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason')),
    async interactionExecute(interaction) {
      if (!checkPerms(interaction.member, interaction.channel, 2))
        return errReply(interaction, 'You do not have permission to use this command.');
      const target = interaction.options.getMember('user');
      const durationStr = interaction.options.getString('duration');
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      if (!target?.moderatable) return errReply(interaction, "I can't timeout that user.");
      const ms = parseTime(durationStr);
      if (!ms) return errReply(interaction, 'Invalid duration. Use `10m`, `2h`, `1d`, etc.');
      if (ms > 28 * 86_400_000) return errReply(interaction, 'Maximum timeout duration is **28 days**.');
      await target.timeout(ms, reason);
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription(`🔇 **${target.user.tag}** timed out for **${durationStr}**. | ${reason}`)
          .setColor(0xff7000)],
      });
    },
  },

  {
    name: 'warn',
    category: 'Moderation',
    description: 'Warns a member and logs it',
    permLevel: 2,
    slashData: new SlashCommandBuilder()
      .setName('warn').setDescription('Warns a member and logs it')
      .addUserOption((o) => o.setName('user').setDescription('Member to warn').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for warning').setRequired(true)),
    async interactionExecute(interaction) {
      if (!checkPerms(interaction.member, interaction.channel, 2))
        return errReply(interaction, 'You do not have permission to use this command.');
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason');
      addWarning(interaction.guild.id, {
        userId: target.id,
        moderatorId: interaction.user.id,
        reason,
        timestamp: Date.now(),
      });
      target.user.send(`⚠️ You have been warned in **${interaction.guild.name}**: ${reason}`).catch(() => {});
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setDescription(`⚠️ **${target.user.tag}** has been warned. | ${reason}`)
          .setColor(0xff7000)],
      });
    },
  },

  {
    name: 'warnings',
    category: 'Moderation',
    description: "Shows a member's warning history",
    permLevel: 2,
    slashData: new SlashCommandBuilder()
      .setName('warnings').setDescription("Shows a member's warning history")
      .addUserOption((o) => o.setName('user').setDescription('Member to check').setRequired(true)),
    async interactionExecute(interaction) {
      if (!checkPerms(interaction.member, interaction.channel, 2))
        return errReply(interaction, 'You do not have permission to use this command.');
      const target = interaction.options.getMember('user');
      const warns = getWarnings(interaction.guild.id, target.id);
      if (!warns.length) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setDescription(`✅ **${target.user.tag}** has no warnings.`).setColor(0x00c853)],
          ephemeral: true,
        });
      }
      const lines = warns.map((w, i) => {
        const mod = interaction.guild.members.cache.get(w.moderatorId);
        return `**${i + 1}.** ${w.reason} — by ${mod?.user.tag ?? 'Unknown'} (<t:${Math.floor(w.timestamp / 1000)}:R>)`;
      });
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle(`⚠️ Warnings for ${target.user.tag}`)
          .setDescription(lines.join('\n'))
          .setColor(0xff7000)
          .setFooter({ text: `${warns.length} warning(s) total` })],
        ephemeral: true,
      });
    },
  },

  // ── Setup ─────────────────────────────────────────────────────────────────────

  {
    name: 'welcome',
    category: 'Setup',
    description: 'Configure welcome messages and cards',
    permLevel: 2,
    slashData: new SlashCommandBuilder()
      .setName('welcome').setDescription('Configure welcome messages')
      .addSubcommand((sub) =>
        sub.setName('channel').setDescription('Set the welcome channel')
          .addChannelOption((o) => o.setName('channel').setDescription('Channel to send welcome messages in').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName('message').setDescription('Set the welcome message. Use {user}, {username}, {server}, {membercount}')
          .addStringOption((o) => o.setName('text').setDescription('Message text').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName('dm').setDescription('Toggle DM welcome message')
          .addBooleanOption((o) => o.setName('enabled').setDescription('Enable or disable DM welcome').setRequired(true))
      )
      .addSubcommand((sub) => sub.setName('test').setDescription('Preview the welcome card'))
      .addSubcommand((sub) => sub.setName('disable').setDescription('Disable welcome messages')),
    async interactionExecute(interaction) {
      if (!checkPerms(interaction.member, interaction.channel, 2))
        return errReply(interaction, 'You do not have permission to use this command.');
      const sub = interaction.options.getSubcommand();
      const { guild } = interaction;

      switch (sub) {
        case 'channel': {
          const channel = interaction.options.getChannel('channel');
          updateConfig(guild.id, { welcome: { ...getConfig(guild.id).welcome, channelId: channel.id } });
          await interaction.reply({ embeds: [new EmbedBuilder().setDescription(`✅ Welcome channel set to ${channel}.`).setColor(0x00c853)], ephemeral: true });
          break;
        }
        case 'message': {
          const text = interaction.options.getString('text');
          updateConfig(guild.id, { welcome: { ...getConfig(guild.id).welcome, message: text } });
          await interaction.reply({ embeds: [new EmbedBuilder().setDescription(`✅ Welcome message set.\n\nPreview: ${text.replace(/{user}/g, interaction.member).replace(/{username}/g, interaction.user.username).replace(/{server}/g, guild.name).replace(/{membercount}/g, guild.memberCount)}`).setColor(0x00c853)], ephemeral: true });
          break;
        }
        case 'dm': {
          const enabled = interaction.options.getBoolean('enabled');
          updateConfig(guild.id, { welcome: { ...getConfig(guild.id).welcome, dm: enabled } });
          await interaction.reply({ embeds: [new EmbedBuilder().setDescription(`✅ DM welcome ${enabled ? 'enabled' : 'disabled'}.`).setColor(0x00c853)], ephemeral: true });
          break;
        }
        case 'test': {
          await interaction.deferReply({ ephemeral: true });
          try {
            const { AttachmentBuilder } = require('discord.js');
            const buf  = await generateCard(interaction.member, guild, 'welcome');
            const file = new AttachmentBuilder(buf, { name: 'welcome.png' });
            await interaction.editReply({ content: '👋 Welcome card preview:', files: [file] });
          } catch (err) {
            await interaction.editReply('Failed to generate card: ' + err.message);
          }
          break;
        }
        case 'disable': {
          const config = getConfig(guild.id);
          updateConfig(guild.id, { welcome: { ...config.welcome, channelId: null } });
          await interaction.reply({ embeds: [new EmbedBuilder().setDescription('✅ Welcome messages disabled.').setColor(0x00c853)], ephemeral: true });
          break;
        }
      }
    },
  },

  {
    name: 'goodbye',
    category: 'Setup',
    description: 'Configure goodbye messages and cards',
    permLevel: 2,
    slashData: new SlashCommandBuilder()
      .setName('goodbye').setDescription('Configure goodbye messages')
      .addSubcommand((sub) =>
        sub.setName('channel').setDescription('Set the goodbye channel')
          .addChannelOption((o) => o.setName('channel').setDescription('Channel to send goodbye messages in').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName('message').setDescription('Set the goodbye message. Use {user}, {username}, {server}, {membercount}')
          .addStringOption((o) => o.setName('text').setDescription('Message text').setRequired(true))
      )
      .addSubcommand((sub) => sub.setName('test').setDescription('Preview the goodbye card'))
      .addSubcommand((sub) => sub.setName('disable').setDescription('Disable goodbye messages')),
    async interactionExecute(interaction) {
      if (!checkPerms(interaction.member, interaction.channel, 2))
        return errReply(interaction, 'You do not have permission to use this command.');
      const sub = interaction.options.getSubcommand();
      const { guild } = interaction;

      switch (sub) {
        case 'channel': {
          const channel = interaction.options.getChannel('channel');
          updateConfig(guild.id, { goodbye: { ...getConfig(guild.id).goodbye, channelId: channel.id } });
          await interaction.reply({ embeds: [new EmbedBuilder().setDescription(`✅ Goodbye channel set to ${channel}.`).setColor(0x00c853)], ephemeral: true });
          break;
        }
        case 'message': {
          const text = interaction.options.getString('text');
          updateConfig(guild.id, { goodbye: { ...getConfig(guild.id).goodbye, message: text } });
          await interaction.reply({ embeds: [new EmbedBuilder().setDescription(`✅ Goodbye message set.`).setColor(0x00c853)], ephemeral: true });
          break;
        }
        case 'test': {
          await interaction.deferReply({ ephemeral: true });
          try {
            const { AttachmentBuilder } = require('discord.js');
            const buf  = await generateCard(interaction.member, guild, 'goodbye');
            const file = new AttachmentBuilder(buf, { name: 'goodbye.png' });
            await interaction.editReply({ content: '👋 Goodbye card preview:', files: [file] });
          } catch (err) {
            await interaction.editReply('Failed to generate card: ' + err.message);
          }
          break;
        }
        case 'disable': {
          const config = getConfig(guild.id);
          updateConfig(guild.id, { goodbye: { ...config.goodbye, channelId: null } });
          await interaction.reply({ embeds: [new EmbedBuilder().setDescription('✅ Goodbye messages disabled.').setColor(0x00c853)], ephemeral: true });
          break;
        }
      }
    },
  },

  {
    name: 'autorole',
    category: 'Setup',
    description: 'Assign a role automatically when someone joins',
    permLevel: 2,
    slashData: new SlashCommandBuilder()
      .setName('autorole').setDescription('Auto-assign a role on join')
      .addSubcommand((sub) =>
        sub.setName('set').setDescription('Set the auto-role')
          .addRoleOption((o) => o.setName('role').setDescription('Role to assign').setRequired(true))
      )
      .addSubcommand((sub) => sub.setName('remove').setDescription('Remove the auto-role')),
    async interactionExecute(interaction) {
      if (!checkPerms(interaction.member, interaction.channel, 2))
        return errReply(interaction, 'You do not have permission to use this command.');
      const sub = interaction.options.getSubcommand();
      if (sub === 'set') {
        const role = interaction.options.getRole('role');
        updateConfig(interaction.guild.id, { autorole: role.id });
        await interaction.reply({ embeds: [new EmbedBuilder().setDescription(`✅ Auto-role set to **${role.name}**. New members will receive it on join.`).setColor(0x00c853)], ephemeral: true });
      } else {
        updateConfig(interaction.guild.id, { autorole: null });
        await interaction.reply({ embeds: [new EmbedBuilder().setDescription('✅ Auto-role removed.').setColor(0x00c853)], ephemeral: true });
      }
    },
  },

  {
    name: 'kick',
    category: 'Moderation',
    description: 'Kicks a member 👢',
    permLevel: 2,
    slashData: new SlashCommandBuilder()
      .setName('kick').setDescription('Kicks a member 👢')
      .addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for kick')),
    async interactionExecute(interaction) {
      if (!checkPerms(interaction.member, interaction.channel, 2))
        return errReply(interaction, 'You do not have permission to use this command.');
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      if (!target?.kickable) return errReply(interaction, "I don't have permission to kick that user.");
      const response = await interaction.reply({
        embeds: [new EmbedBuilder().setDescription(`👢 Kick **${target.user.tag}**?\nReason: ${reason}`).setColor(0xff7000)],
        components: [confirmRow()],
        ephemeral: true,
        fetchReply: true,
      });
      try {
        const btn = await response.awaitMessageComponent({ filter: (i) => i.user.id === interaction.user.id, time: 30_000 });
        if (btn.customId === 'confirm') {
          await target.kick(reason);
          await btn.update({
            embeds: [new EmbedBuilder().setDescription(`👢 **${target.user.tag}** has been kicked. | ${reason}`).setColor(0xff7000)],
            components: [],
          });
          interaction.channel.send({ embeds: [new EmbedBuilder().setDescription(`👢 **${target.user.tag}** was kicked by ${interaction.member}. | ${reason}`).setColor(0xff7000)] });
        } else {
          await btn.update({ embeds: [new EmbedBuilder().setDescription('❌ Cancelled.').setColor(0x888888)], components: [] });
        }
      } catch {
        await interaction.editReply({ embeds: [new EmbedBuilder().setDescription('⏱️ Timed out — no action taken.').setColor(0x888888)], components: [] });
      }
    },
  },


  // ── Music ────────────────────────────────────────────────────────────────────

  {
    name: 'play', description: 'Play a song, YouTube/Spotify/Apple Music URL or playlist', category: 'Music', permLevel: 0,
    slashData: new SlashCommandBuilder()
      .setName('play').setDescription('Play a song, YouTube/Spotify/Apple Music URL or playlist')
      .addStringOption(o => o.setName('query').setDescription('Song name, YouTube, Spotify, or Apple Music URL').setRequired(true)),
    async interactionExecute(interaction) {
      const query  = interaction.options.getString('query');
      const member = interaction.member;
      const vc     = member.voice?.channel;
      if (!vc) return errReply(interaction, 'You need to be in a voice channel first.');

      await interaction.deferReply();

      let queue = getQueue(interaction.guildId);
      if (!queue) {
        queue = new MusicQueue(interaction.guildId, vc, interaction.channel);
        setQueue(interaction.guildId, queue);
        try { await queue.connect(); } catch (err) {
          return interaction.editReply({ content: `❌ ${err.message}` });
        }
      } else if (queue.voiceChannel.id !== vc.id) {
        return interaction.editReply({ content: '❌ You must be in the same voice channel as me.' });
      }

      try {
        const playdl = require('play-dl');

        // ── Apple Music ───────────────────────────────────────────────────────
        if (query.includes('music.apple.com')) {
          const items = await resolveAppleMusic(query);
          if (!items) return interaction.editReply({ content: '❌ Apple Music playlists are not supported — try a track or album link.' });
          if (!items.length) return interaction.editReply({ content: '❌ Could not find that Apple Music item.' });

          let queued = 0;
          for (const item of items) {
            const results = await playdl.search(item.search, { source: { youtube: 'video' }, limit: 1 });
            if (!results.length) continue;
            const v = results[0];
            await queue.addTrack({ title: item.title, url: v.url, duration: v.durationRaw ?? '?', requestedBy: member.displayName });
            queued++;
          }

          return interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0xfc3c44)
              .setTitle(items.length > 1 ? '🍎 Apple Music Album Queued' : '🍎 Apple Music Track Queued')
              .setDescription(items.length > 1
                ? `Queued **${queued}** tracks from Apple Music.`
                : `Queued **${items[0].title}** via Apple Music.`)
              .addFields({ name: 'Requested by', value: member.displayName, inline: true })],
          });
          return; // Apple Music handled — stop here
        }

        // ── Spotify ───────────────────────────────────────────────────────────
        await ensureSpotify(playdl);
        let spType = false;
        try { spType = playdl.sp_validate(query); } catch { spType = false; }
        if (spType && spType !== 'search') {
          if (!process.env.SPOTIFY_CLIENT_ID) return interaction.editReply({ content: '❌ Spotify is not configured. Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in your environment.' });

          const spData = await playdl.spotify(query);
          const spTracks = spType === 'track'
            ? [spData]
            : await spData.all_tracks();

          let queued = 0;
          for (const t of spTracks) {
            const searchQ  = `${t.name} ${t.artists?.map(a => a.name).join(' ') ?? ''}`;
            const results  = await playdl.search(searchQ, { source: { youtube: 'video' }, limit: 1 });
            if (!results.length) continue;
            const v = results[0];
            await queue.addTrack({ title: `${t.name} — ${t.artists?.[0]?.name ?? ''}`, url: v.url, duration: v.durationRaw ?? '?', requestedBy: member.displayName });
            queued++;
          }

          const label = spType === 'track' ? '🟢 Spotify Track Queued' : `🟢 Spotify ${spType === 'album' ? 'Album' : 'Playlist'} Queued`;
          return interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x1db954)
              .setTitle(label)
              .setDescription(spType === 'track'
                ? `Queued **${spTracks[0].name}**.`
                : `Queued **${queued}** tracks from **${spData.name}**.`)
              .addFields({ name: 'Requested by', value: member.displayName, inline: true })],
          });
        }

        // ── YouTube playlist ──────────────────────────────────────────────────
        const urlType = playdl.yt_validate(query);
        if (urlType === 'playlist') {
          const playlist = await playdl.playlist_info(query, { incomplete: true });
          const videos   = await playlist.all_videos();
          if (!videos.length) return interaction.editReply({ content: '❌ Playlist is empty or private.' });

          for (const video of videos) {
            await queue.addTrack({ title: video.title, url: video.url, duration: video.durationRaw ?? 'Live', requestedBy: member.displayName });
          }

          return interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x5865f2)
              .setTitle('📋 YouTube Playlist Queued')
              .setDescription(`**[${playlist.title}](${query})**`)
              .addFields(
                { name: 'Tracks added', value: `${videos.length}`, inline: true },
                { name: 'Requested by', value: member.displayName, inline: true },
              )],
          });
        }

        // ── Single YouTube video or search ────────────────────────────────────
        let video;
        if (urlType === 'video') {
          const info = await playdl.video_info(query);
          video = info.video_details;
        } else {
          const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 1 });
          if (!results.length) return interaction.editReply({ content: '❌ No results found.' });
          video = results[0];
        }

        const track = { title: video.title, url: video.url, duration: video.durationRaw ?? 'Live', requestedBy: member.displayName };
        await queue.addTrack(track);
        const isFirst = queue.current?.url === track.url && !queue.tracks.length;
        if (!isFirst) {
          await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x5865f2)
              .setDescription(`➕ Added to queue: **[${track.title}](${track.url})**`)
              .addFields({ name: 'Position', value: `#${queue.tracks.length}`, inline: true },
                         { name: 'Duration', value: track.duration, inline: true })],
          });
        } else {
          await interaction.editReply({ content: '▶️ Starting playback…' });
        }
      } catch (err) {
        console.error('[Music] play error:', err);
        interaction.editReply({ content: '❌ Failed to fetch that track.' });
      }
    },
  },

  {
    name: 'skip', description: 'Skip the current song', category: 'Music', permLevel: 0,
    slashData: new SlashCommandBuilder().setName('skip').setDescription('Skip the current song'),
    async interactionExecute(interaction) {
      const queue = getQueue(interaction.guildId);
      if (!queue?.current) return errReply(interaction, 'Nothing is playing.');
      queue.skip();
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription('⏭️ Skipped.')] });
    },
  },

  {
    name: 'stop', description: 'Stop music and disconnect from voice', category: 'Music', permLevel: 0,
    slashData: new SlashCommandBuilder().setName('stop').setDescription('Stop music and disconnect from voice'),
    async interactionExecute(interaction) {
      const queue = getQueue(interaction.guildId);
      if (!queue) return errReply(interaction, 'Nothing is playing.');
      queue.stop();
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription('⏹️ Stopped and disconnected.')] });
    },
  },

  {
    name: 'pause', description: 'Pause the current song', category: 'Music', permLevel: 0,
    slashData: new SlashCommandBuilder().setName('pause').setDescription('Pause the current song'),
    async interactionExecute(interaction) {
      const queue = getQueue(interaction.guildId);
      if (!queue?.current) return errReply(interaction, 'Nothing is playing.');
      const ok = queue.pause();
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription(ok ? '⏸️ Paused.' : '❌ Already paused.')] });
    },
  },

  {
    name: 'resume', description: 'Resume the paused song', category: 'Music', permLevel: 0,
    slashData: new SlashCommandBuilder().setName('resume').setDescription('Resume the paused song'),
    async interactionExecute(interaction) {
      const queue = getQueue(interaction.guildId);
      if (!queue?.current) return errReply(interaction, 'Nothing is playing.');
      const ok = queue.resume();
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription(ok ? '▶️ Resumed.' : '❌ Not paused.')] });
    },
  },

  {
    name: 'queue', description: 'Show the current music queue', category: 'Music', permLevel: 0,
    slashData: new SlashCommandBuilder().setName('queue').setDescription('Show the current music queue'),
    async interactionExecute(interaction) {
      const queue = getQueue(interaction.guildId);
      if (!queue?.current) return errReply(interaction, 'The queue is empty.');
      const lines = queue.tracks.slice(0, 10).map((t, i) => `**${i + 1}.** [${t.title}](${t.url}) — ${t.duration}`);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎵 Music Queue')
        .setDescription(`**Now Playing:** [${queue.current.title}](${queue.current.url})\n\n${lines.length ? lines.join('\n') : '*Queue is empty*'}`)
        .setFooter({ text: `${queue.tracks.length} track(s) in queue${queue.loop ? ' • Loop ON' : ''}` });
      await interaction.reply({ embeds: [embed] });
    },
  },

  {
    name: 'nowplaying', description: 'Show the currently playing song', category: 'Music', permLevel: 0,
    slashData: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the currently playing song'),
    async interactionExecute(interaction) {
      const queue = getQueue(interaction.guildId);
      if (!queue?.current) return errReply(interaction, 'Nothing is playing.');
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎵 Now Playing')
        .setDescription(`**[${queue.current.title}](${queue.current.url})**`)
        .addFields(
          { name: 'Duration',     value: queue.current.duration,    inline: true },
          { name: 'Requested by', value: queue.current.requestedBy, inline: true },
          { name: 'Loop',         value: queue.loop ? 'On' : 'Off',  inline: true },
        );
      await interaction.reply({ embeds: [embed] });
    },
  },

  {
    name: 'loop', description: 'Toggle loop for the current song', category: 'Music', permLevel: 0,
    slashData: new SlashCommandBuilder().setName('loop').setDescription('Toggle loop for the current song'),
    async interactionExecute(interaction) {
      const queue = getQueue(interaction.guildId);
      if (!queue?.current) return errReply(interaction, 'Nothing is playing.');
      queue.loop = !queue.loop;
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription(`🔁 Loop is now **${queue.loop ? 'ON' : 'OFF'}**.`)] });
    },
  },

  {
    name: 'volume', description: 'Show the current volume (adjustable via your system)', category: 'Music', permLevel: 0,
    slashData: new SlashCommandBuilder().setName('volume').setDescription('Show volume info'),
    async interactionExecute(interaction) {
      const queue = getQueue(interaction.guildId);
      if (!queue?.current) return errReply(interaction, 'Nothing is playing.');
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription('🔊 Volume is controlled by Discord\'s per-user volume slider.\nRight-click the bot in the voice channel to adjust.')] });
    },
  },

];

// ─── Shared embed/text helpers (used by button handler) ───────────────────────

async function fetchCatUrl() {
  const res  = await fetch('https://api.thecatapi.com/v1/images/search');
  const data = await res.json();
  const url  = data[0]?.url;
  if (!url) throw new Error('No URL');
  return url;
}

function catEmbed(url) {
  return new EmbedBuilder().setImage(url).setColor(0x00bcd4);
}

function foodEmbed() {
  const pick = FOOD[Math.floor(Math.random() * FOOD.length)];
  return new EmbedBuilder().setDescription(`🍽️ How about **${pick}**?`).setColor(0xff9800);
}

function rollText() {
  const result = Math.floor(Math.random() * 6) + 1;
  return result < 3 ? `🎲 You rolled a **${result}**! Better luck next time...` : `🎲 You rolled a **${result}**!`;
}

// ─── Button interaction handler ───────────────────────────────────────────────

async function handleButton(interaction) {
  const id = interaction.customId;

  // RPS: rps:{choice}:{userId}
  if (id.startsWith('rps:')) {
    const [, choice, userId] = id.split(':');
    if (interaction.user.id !== userId)
      return interaction.reply({ content: "This isn't your game! Use `/rps` to start your own.", ephemeral: true });
    await interaction.update({ embeds: [], content: rpsResultText(choice), components: [] });
    return;
  }

  // Vote: vote:{guildId}:{optionIndex}
  if (id.startsWith('vote:')) {
    const [, guildId, indexStr] = id.split(':');
    const poll = polls.get(guildId);
    if (!poll) return interaction.reply({ content: 'This poll has already ended.', ephemeral: true });
    if (poll.votes[interaction.user.id] !== undefined)
      return interaction.reply({ content: '❌ You already voted in this poll!', ephemeral: true });
    const optionIndex = parseInt(indexStr);
    poll.votes[interaction.user.id] = optionIndex + 1;
    savePoll(guildId);
    return interaction.reply({ content: `✅ Voted for **${poll.answers[optionIndex]}**!`, ephemeral: true });
  }

  // Cat refresh
  if (id === 'cat_new') {
    await interaction.deferUpdate();
    try {
      const url = await fetchCatUrl();
      await interaction.editReply({ embeds: [catEmbed(url)], components: [catRow()] });
    } catch {
      await interaction.editReply({ content: 'Could not fetch a new cat!', components: [] });
    }
    return;
  }

  // Food reroll
  if (id === 'food_new') {
    await interaction.update({ embeds: [foodEmbed()], components: [foodRow()] });
    return;
  }

  // Roll again
  if (id === 'roll_new') {
    await interaction.update({ content: rollText(), components: [rollRow()] });
    return;
  }

  // Coinflip
  if (id === 'coinflip_new') {
    await interaction.update({ embeds: [coinflipEmbed()], components: [coinflipRow()] });
    return;
  }

  // Slots spin
  if (id === 'slots_spin') {
    await interaction.update({ embeds: [slotsEmbed(spinSlots())], components: [slotsRow()] });
    return;
  }

  // Next joke
  if (id === 'joke_new') {
    await interaction.update({
      content: `😂 ${JOKES[Math.floor(Math.random() * JOKES.length)]}`,
      components: [jokeRow()],
    });
    return;
  }

  // Music controls
  if (id.startsWith('music_')) {
    const { getQueue } = require('./util/musicQueue');
    const queue = getQueue(interaction.guildId);
    if (!queue?.current) {
      return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
    }
    await interaction.deferUpdate();

    if (id === 'music_pause') {
      queue.pause();
    } else if (id === 'music_resume') {
      queue.resume();
    } else if (id === 'music_skip') {
      queue.skip();
    } else if (id === 'music_stop') {
      queue.stop();
    } else if (id === 'music_loop') {
      queue.loop = !queue.loop;
    } else if (id === 'music_vol_dn') {
      queue.setVolume(queue.volume - 10);
    } else if (id === 'music_vol_up') {
      queue.setVolume(queue.volume + 10);
    }

    // Refresh the embed (skip/stop trigger _playNext themselves)
    if (id !== 'music_skip' && id !== 'music_stop') {
      await queue._updateNowPlaying();
    }
    return;
  }
}

// ─── Build command map ────────────────────────────────────────────────────────

const commands = new Map();
for (const cmd of COMMAND_LIST) commands.set(cmd.name, cmd);

module.exports = { commands, loadPolls, COMMAND_LIST, handleButton };
