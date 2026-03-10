'use strict';

const { EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const { PREFIX, VERSION } = require('./util/constants');
const { ANSWERS, JOKES, FOOD } = require('./util/quotes');
const { checkPerms, getPermLevel } = require('./core/permsCore');

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

function buildPollEmbed(poll, guild) {
  const creator = guild.members.cache.get(poll.creatorId);
  const lines = poll.answers.map((a, i) => {
    const count = Object.values(poll.votes).filter((v) => v === i + 1).length;
    return `${VOTE_EMOJIS[i]} ${a} — **${count}** vote(s)`;
  });
  return new EmbedBuilder()
    .setAuthor({ name: `${creator?.displayName ?? 'Unknown'}'s poll`, iconURL: creator?.user.displayAvatarURL() })
    .setDescription(`✏️ **${poll.heading}**\n\n${lines.join('\n')}`)
    .setFooter({ text: `Vote with: ${PREFIX}vote v <number>` })
    .setColor(0x00bcd4);
}

function sendError(channel, text) {
  channel.send({ embeds: [new EmbedBuilder().setDescription(text).setColor(0xff0000)] });
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

// ─── Uptime helper ────────────────────────────────────────────────────────────

function formatUptime(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60),
        h = Math.floor(m / 60),    d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ─── RPS helpers ─────────────────────────────────────────────────────────────

const RPS_CHOICES = ['rock', 'paper', 'scissors'];
const RPS_EMOJI   = { rock: '🪨', paper: '🗞️', scissors: '✂️' };
const RPS_OUTCOME = {
  rock:     { rock: 'draw', paper: 'lose', scissors: 'win' },
  paper:    { rock: 'win',  paper: 'draw', scissors: 'lose' },
  scissors: { rock: 'lose', paper: 'win',  scissors: 'draw' },
};

// ─── React emoji pool ─────────────────────────────────────────────────────────

const HYPE_EMOJIS = ['❤️','🔥','🍆','💯','😍','👀','🤩','💪','🙌','👌','🎉','⚡','🌶️','💥','😤'];

// ─────────────────────────────────────────────────────────────────────────────
//  COMMAND LIST
//  Each entry: { name, aliases?, category, description, usage, permLevel, execute }
//  permLevel: 0 = everyone | 1 = Member+ | 2 = Moderator/Owner
// ─────────────────────────────────────────────────────────────────────────────

const COMMAND_LIST = [

  // ── Information ─────────────────────────────────────────────────────────────

  {
    name: 'commands',
    category: 'Information',
    description: 'Shows all commands available to you',
    usage: `${PREFIX}commands`,
    permLevel: 0,
    async execute(args, message) {
      const userLevel = getPermLevel(message.member);
      const visible = COMMAND_LIST.filter((c) => c.permLevel <= userLevel);

      const grouped = {};
      for (const cmd of visible) {
        if (!grouped[cmd.category]) grouped[cmd.category] = [];
        const nameStr = cmd.aliases
          ? `\`${PREFIX}${cmd.name}\` *(or ${cmd.aliases.map((a) => `\`${PREFIX}${a}\``).join(', ')})*`
          : `\`${PREFIX}${cmd.name}\``;
        grouped[cmd.category].push(`${nameStr} — ${cmd.description}`);
      }

      const CATEGORY_EMOJI = {
        Information: 'ℹ️', Fun: '🎉', Voting: '🗳️', VIP: '⭐', Moderation: '🔨',
      };

      const embed = new EmbedBuilder()
        .setTitle('📋 Available Commands')
        .setColor(0x5865f2)
        .setFooter({ text: `Showing commands for your permission level` });

      for (const [cat, lines] of Object.entries(grouped)) {
        embed.addFields({
          name: `${CATEGORY_EMOJI[cat] ?? '•'} ${cat}`,
          value: lines.join('\n'),
        });
      }

      message.channel.send({ embeds: [embed] });
    },
  },

  {
    name: 'info',
    aliases: ['bot', 'about'],
    category: 'Information',
    description: 'Shows bot status, uptime and version',
    usage: `${PREFIX}info`,
    permLevel: 0,
    async execute(args, message) {
      const client = message.client;
      const embed = new EmbedBuilder()
        .setTitle('🤖 George — Bot Info')
        .setThumbnail(client.user.displayAvatarURL())
        .setColor(0x00bcd4)
        .addFields(
          { name: '✅ Status',  value: 'Online and ready!', inline: true },
          { name: '⏱️ Uptime', value: formatUptime(client.uptime), inline: true },
          { name: '📦 Version', value: `v${VERSION}`, inline: true },
          { name: '💡 Tip',    value: `Use \`${PREFIX}commands\` to see everything I can do!` }
        )
        .setFooter({ text: `Serving ${client.guilds.cache.size} server(s)` })
        .setTimestamp();
      message.channel.send({ embeds: [embed] });
    },
  },

  {
    name: 'weather',
    category: 'Information',
    description: 'Shows current weather for a city',
    usage: `${PREFIX}weather <city>`,
    permLevel: 0,
    async execute(args, message) {
      if (!args.length) return message.channel.send(`Usage: \`${PREFIX}weather <city>\``);
      const city = args.join(' ');
      try {
        const res = await fetch(
          `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
          { headers: { 'User-Agent': 'SupremeBot/1.0' } }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const cur  = data.current_condition[0];
        const area = data.nearest_area[0];
        const location = [area.areaName[0]?.value, area.region[0]?.value, area.country[0]?.value]
          .filter(Boolean).join(', ');
        const condition = cur.weatherDesc[0]?.value ?? 'Unknown';
        const embed = new EmbedBuilder()
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
        message.channel.send({ embeds: [embed] });
      } catch {
        message.channel.send(`Could not fetch weather for **${city}**. Check the city name and try again.`);
      }
    },
  },

  {
    name: 'avatar',
    category: 'Information',
    description: "Displays your avatar or a mentioned member's",
    usage: `${PREFIX}avatar [@member]`,
    permLevel: 0,
    async execute(args, message) {
      const target = message.mentions.users.first() ?? message.author;
      const embed = new EmbedBuilder()
        .setTitle(`🖼️ ${target.username}'s avatar`)
        .setImage(target.displayAvatarURL({ size: 512 }))
        .setColor(0x5865f2);
      message.channel.send({ embeds: [embed] });
    },
  },

  // ── Fun ──────────────────────────────────────────────────────────────────────

  {
    name: 'ping',
    category: 'Fun',
    description: 'Returns Pong! 🏓',
    usage: `${PREFIX}ping`,
    permLevel: 0,
    async execute(args, message) {
      message.channel.send('Pong! 🏓');
    },
  },

  {
    name: 'sup',
    aliases: ['whats up'],
    category: 'Fun',
    description: 'Ask George what\'s up',
    usage: `${PREFIX}sup`,
    permLevel: 0,
    async execute(args, message) {
      message.channel.send(ANSWERS[Math.floor(Math.random() * ANSWERS.length)]);
    },
  },

  {
    name: 'cat',
    category: 'Fun',
    description: 'Sends a random cat image',
    usage: `${PREFIX}cat`,
    permLevel: 0,
    async execute(args, message) {
      try {
        const res  = await fetch('https://api.thecatapi.com/v1/images/search');
        const data = await res.json();
        const url  = data[0]?.url;
        if (!url) throw new Error('No URL');
        message.channel.send({ embeds: [new EmbedBuilder().setImage(url).setColor(0x00bcd4)] });
      } catch {
        message.channel.send('Could not fetch a cat image right now. Try again later!');
      }
    },
  },

  {
    name: 'roll',
    category: 'Fun',
    description: 'Rolls a 6-sided dice 🎲',
    usage: `${PREFIX}roll`,
    permLevel: 0,
    async execute(args, message) {
      const result = Math.floor(Math.random() * 6) + 1;
      message.channel.send(
        result < 3
          ? `🎲 You rolled a **${result}**! Better luck next time...`
          : `🎲 You rolled a **${result}**!`
      );
    },
  },

  {
    name: 'joke',
    category: 'Fun',
    description: 'Tells a random joke 😂',
    usage: `${PREFIX}joke`,
    permLevel: 0,
    async execute(args, message) {
      message.channel.send(`😂 ${JOKES[Math.floor(Math.random() * JOKES.length)]}`);
    },
  },

  {
    name: 'ymjoke',
    category: 'Fun',
    description: 'Tells a yo mama joke at a mentioned member',
    usage: `${PREFIX}ymjoke <@member>`,
    permLevel: 0,
    async execute(args, message) {
      const target = message.mentions.users.first();
      if (!target) return message.channel.send(`Usage: \`${PREFIX}ymjoke <@member>\``);
      try {
        const res  = await fetch('https://www.yomama-jokes.com/api/v1/jokes/random/');
        const data = await res.json();
        message.channel.send(`😂 ${target}, ${data.joke ?? "Yo mama so slow, she's still loading."}`);
      } catch {
        message.channel.send('Could not fetch a joke right now. Try again later!');
      }
    },
  },

  {
    name: 'food',
    category: 'Fun',
    description: 'Suggests something to eat 🍔',
    usage: `${PREFIX}food`,
    permLevel: 0,
    async execute(args, message) {
      const pick = FOOD[Math.floor(Math.random() * FOOD.length)];
      message.channel.send({
        embeds: [new EmbedBuilder().setDescription(`🍽️ How about **${pick}**?`).setColor(0xff9800)],
      });
    },
  },

  {
    name: 'rps',
    category: 'Fun',
    description: 'Play Rock Paper Scissors against George 🪨🗞️✂️',
    usage: `${PREFIX}rps <rock / paper / scissors>`,
    permLevel: 0,
    async execute(args, message) {
      const choice = args[0]?.toLowerCase();
      if (!RPS_CHOICES.includes(choice))
        return message.channel.send(`Usage: \`${PREFIX}rps <rock / paper / scissors>\``);

      const bot    = RPS_CHOICES[Math.floor(Math.random() * 3)];
      const result = RPS_OUTCOME[choice][bot];
      const lines  = {
        win:  `🎉 You win! ${RPS_EMOJI[choice]} beats ${RPS_EMOJI[bot]}`,
        lose: `😈 I win! ${RPS_EMOJI[bot]} beats ${RPS_EMOJI[choice]}`,
        draw: `🤝 It's a draw! We both chose ${RPS_EMOJI[choice]}`,
      };
      message.channel.send(`You chose ${RPS_EMOJI[choice]} — I chose ${RPS_EMOJI[bot]}\n${lines[result]}`);
    },
  },

  {
    name: 'rip',
    category: 'Fun',
    description: 'Generates a tombstone for a member ⚰️',
    usage: `${PREFIX}rip <@member> [tombstone text]`,
    permLevel: 0,
    async execute(args, message) {
      const target = message.mentions.members.first();
      if (!target) return message.channel.send(`Usage: \`${PREFIX}rip <@member> [text]\``);

      const text = args.slice(1).join(' ').replace(/<@!?\d+>/g, '').trim()
        || `R.I.P ${target.displayName}`;
      const avatarUrl = target.user.displayAvatarURL({ extension: 'png', size: 256 });
      const ripUrl    = `https://vacefron.nl/api/rip?user=${encodeURIComponent(avatarUrl)}`;

      message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('⚰️ R.I.P')
            .setDescription(`*${text}*`)
            .setImage(ripUrl)
            .setColor(0x2c2c2c)
            .setFooter({ text: `Gone but not forgotten — ${target.displayName}` }),
        ],
      });
    },
  },

  // ── Voting ───────────────────────────────────────────────────────────────────

  {
    name: 'vote',
    category: 'Voting',
    description: 'Poll system — subcommands: `create`, `v`, `stats`, `close`',
    usage: `${PREFIX}vote create <heading> | <opt1> | <opt2> ...`,
    permLevel: 0,
    async execute(args, message) {
      const { guild, channel, member, author } = message;

      if (!args.length) {
        return sendError(channel,
          `Usage:\n\`${PREFIX}vote create <heading> | <opt1> | <opt2> ...\`\n` +
          `\`${PREFIX}vote v <number>\`\n\`${PREFIX}vote stats\`\n\`${PREFIX}vote close\``
        );
      }

      switch (args[0].toLowerCase()) {

        case 'create': {
          if (polls.has(guild.id)) return sendError(channel, 'There is already a vote running in this server!');
          const parts = args.slice(1).join(' ').split(/\|\s*/);
          if (parts.length < 3) return sendError(channel, `Provide a heading and at least 2 options separated by \`|\``);
          if (parts.length - 1 > 10) return sendError(channel, 'A poll can have a maximum of 10 options.');
          const [heading, ...answers] = parts;
          const poll = { creatorId: member.id, heading: heading.trim(), answers: answers.map((a) => a.trim()), votes: {} };
          polls.set(guild.id, poll);
          savePoll(guild.id);
          channel.send({ embeds: [buildPollEmbed(poll, guild)] });
          break;
        }

        case 'v': {
          if (!polls.has(guild.id)) return sendError(channel, 'There is no poll running!');
          const poll = polls.get(guild.id);
          const num  = parseInt(args[1]);
          if (isNaN(num) || num < 1 || num > poll.answers.length)
            return sendError(channel, 'Please enter a valid number to vote for!');
          if (poll.votes[author.id] !== undefined)
            return sendError(channel, 'You can only vote **once** per poll!');
          poll.votes[author.id] = num;
          savePoll(guild.id);
          await message.delete().catch(() => {});
          break;
        }

        case 'stats': {
          if (!polls.has(guild.id)) return sendError(channel, 'There is no vote running!');
          channel.send({ embeds: [buildPollEmbed(polls.get(guild.id), guild)] });
          break;
        }

        case 'close': {
          if (!polls.has(guild.id)) return sendError(channel, 'There is no vote running!');
          const poll = polls.get(guild.id);
          if (poll.creatorId !== member.id) {
            const creator = guild.members.cache.get(poll.creatorId);
            return sendError(channel, `Only the creator (${creator ?? 'Unknown'}) can close this poll!`);
          }
          polls.delete(guild.id);
          savePoll(guild.id);
          channel.send({ embeds: [buildPollEmbed(poll, guild)] });
          channel.send({ embeds: [new EmbedBuilder().setDescription(`Poll closed by ${member}.`).setColor(0xff7000)] });
          break;
        }

        default:
          sendError(channel, 'Unknown subcommand. Use `create`, `v`, `stats`, or `close`.');
      }
    },
  },

  // ── VIP ──────────────────────────────────────────────────────────────────────

  {
    name: 'say',
    category: 'VIP',
    description: 'Makes George broadcast a message 📢',
    usage: `${PREFIX}say <text>`,
    permLevel: 1,
    async execute(args, message) {
      if (!checkPerms(message.member, message.channel, 1)) return;
      if (!args.length) return message.channel.send(`Usage: \`${PREFIX}say <text>\``);
      await message.delete().catch(() => {});
      message.channel.send(`📢 ${args.join(' ')}`);
    },
  },

  {
    name: 'react',
    category: 'VIP',
    description: 'Reacts to a message with hype emojis',
    usage: `${PREFIX}react <messageID> <amount>`,
    permLevel: 1,
    async execute(args, message) {
      if (!checkPerms(message.member, message.channel, 1)) return;
      const [msgId, amountArg] = args;
      if (!msgId || !amountArg) return message.channel.send(`Usage: \`${PREFIX}react <messageID> <amount>\``);
      const amount = parseInt(amountArg);
      if (isNaN(amount) || amount < 1 || amount > HYPE_EMOJIS.length)
        return message.channel.send(`Amount must be between 1 and ${HYPE_EMOJIS.length}.`);
      let target;
      try { target = await message.channel.messages.fetch(msgId); }
      catch { return message.channel.send("Couldn't find that message in this channel."); }
      await message.delete().catch(() => {});
      const picked = [...HYPE_EMOJIS].sort(() => Math.random() - 0.5).slice(0, amount);
      for (const emoji of picked) await target.react(emoji).catch(() => {});
    },
  },

  // ── Moderation ───────────────────────────────────────────────────────────────

  {
    name: 'clear',
    category: 'Moderation',
    description: 'Deletes 2–100 messages from the channel',
    usage: `${PREFIX}clear <2-100>`,
    permLevel: 2,
    async execute(args, message) {
      if (!checkPerms(message.member, message.channel, 2)) return;
      const amount = parseInt(args[0]);
      if (isNaN(amount) || amount < 2 || amount > 100)
        return message.channel.send('Please provide a number between 2 and 100.');
      await message.channel.bulkDelete(amount, true).catch(() => {
        message.channel.send('Failed to delete messages. Messages older than 14 days cannot be bulk deleted.');
        return;
      });
      const notice = await message.channel.send(`✅ Deleted **${amount}** messages.`);
      setTimeout(() => notice.delete().catch(() => {}), 3000);
    },
  },

  {
    name: 'ban',
    category: 'Moderation',
    description: 'Bans a mentioned member 🔨',
    usage: `${PREFIX}ban <@member> [reason]`,
    permLevel: 2,
    async execute(args, message) {
      if (!checkPerms(message.member, message.channel, 2)) return;
      const target = message.mentions.members.first();
      if (!target) return message.channel.send(`Usage: \`${PREFIX}ban <@member>\``);
      if (!target.bannable) return message.channel.send("I don't have permission to ban that user.");
      const reason = args.slice(1).join(' ') || 'No reason provided';
      await target.ban({ reason }).catch(() => { message.channel.send('Failed to ban that user.'); return; });
      message.channel.send({
        embeds: [new EmbedBuilder().setDescription(`🔨 **${target.user.tag}** has been banned. | ${reason}`).setColor(0xff0000)],
      });
    },
  },

  {
    name: 'kick',
    category: 'Moderation',
    description: 'Kicks a mentioned member 👢',
    usage: `${PREFIX}kick <@member> [reason]`,
    permLevel: 2,
    async execute(args, message) {
      if (!checkPerms(message.member, message.channel, 2)) return;
      const target = message.mentions.members.first();
      if (!target) return message.channel.send(`Usage: \`${PREFIX}kick <@member>\``);
      if (!target.kickable) return message.channel.send("I don't have permission to kick that user.");
      const reason = args.slice(1).join(' ') || 'No reason provided';
      await target.kick(reason).catch(() => { message.channel.send('Failed to kick that user.'); return; });
      message.channel.send({
        embeds: [new EmbedBuilder().setDescription(`👢 **${target.user.tag}** has been kicked. | ${reason}`).setColor(0xff7000)],
      });
    },
  },

];

// ─── Build command map (includes aliases) ─────────────────────────────────────

const commands = new Map();
for (const cmd of COMMAND_LIST) {
  commands.set(cmd.name, cmd);
  if (cmd.aliases) for (const alias of cmd.aliases) commands.set(alias, cmd);
}

module.exports = { commands, loadPolls };
