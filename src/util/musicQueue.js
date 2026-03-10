'use strict';

const {
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
} = require('@discordjs/voice');
const ytdl  = require('@distube/ytdl-core');
const play  = require('play-dl');
const { EmbedBuilder } = require('discord.js');
const { logAction }    = require('../webui/logger');

// ── Cookie agent for @distube/ytdl-core ──────────────────────────────────────
let _ytdlAgent;
if (process.env.YOUTUBE_COOKIE) {
  try {
    // parse "name=value; name2=value2" cookie string into array of objects
    const cookies = process.env.YOUTUBE_COOKIE.split(';').map(c => {
      const [name, ...rest] = c.trim().split('=');
      return { name: name.trim(), value: rest.join('=').trim() };
    });
    _ytdlAgent = ytdl.createAgent(cookies);
    console.log('[Music] YouTube cookie agent created.');
  } catch (e) {
    console.warn('[Music] Failed to create cookie agent:', e.message);
  }
}

function ytdlOptions() {
  return {
    filter:          'audioonly',
    quality:         'highestaudio',
    highWaterMark:   1 << 25, // 32 MB
    ...(  _ytdlAgent ? { agent: _ytdlAgent } : {}),
  };
}

const queues = new Map(); // guildId -> MusicQueue

class MusicQueue {
  constructor(guildId, voiceChannel, textChannel) {
    this.guildId      = guildId;
    this.voiceChannel = voiceChannel;
    this.textChannel  = textChannel;
    this.tracks       = [];
    this.current      = null;
    this.loop         = false;
    this.volume       = 100;
    this.connection   = null;
    this.leaveTimer   = null;

    this.player = createAudioPlayer();

    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this.loop && this.current) this.tracks.unshift(this.current);
      this._playNext();
    });

    this.player.on('error', err => {
      console.error('[Music] Player error:', err.message);
      this._playNext();
    });
  }

  async connect() {
    this.connection = joinVoiceChannel({
      channelId:      this.voiceChannel.id,
      guildId:        this.guildId,
      adapterCreator: this.voiceChannel.guild.voiceAdapterCreator,
      selfDeaf:       true,
    });
    this.connection.subscribe(this.player);

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 10_000);
    } catch {
      this.connection.destroy();
      queues.delete(this.guildId);
      throw new Error('Could not join voice channel.');
    }

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling,  5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting,  5_000),
        ]);
      } catch {
        this.destroy();
      }
    });
  }

  async addTrack(track) {
    this.tracks.push(track);
    if (this.player.state.status === AudioPlayerStatus.Idle && !this.current) {
      await this._playNext();
    }
  }

  // Resolve a track's URL — if it's a search query (no http), search YouTube
  async _resolveUrl(track) {
    if (typeof track.url === 'string' && track.url.startsWith('http')) return track.url;
    // URL is missing or invalid — search by title
    console.warn(`[Music] No URL for "${track.title}" — searching YouTube by title`);
    const results = await play.search(track.title, { source: { youtube: 'video' }, limit: 1 });
    if (!results.length) throw new Error(`No YouTube results for "${track.title}"`);
    return results[0].url;
  }

  async _stream(url) {
    const stream = ytdl(url, ytdlOptions());
    return createAudioResource(stream, { inputType: StreamType.Arbitrary });
  }

  async _playNext() {
    clearTimeout(this.leaveTimer);

    if (!this.tracks.length) {
      this.current  = null;
      this.leaveTimer = setTimeout(() => this.destroy(), 60_000);
      return;
    }

    this.current = this.tracks.shift();

    try {
      // Resolve URL if needed
      const url      = await this._resolveUrl(this.current);
      this.current   = { ...this.current, url };

      const resource = await this._stream(url);
      this.player.play(resource);

      logAction('music', `Now playing: ${this.current.title} [${this.current.duration}] — requested by ${this.current.requestedBy}`);

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎵 Now Playing')
        .setDescription(`**[${this.current.title}](${this.current.url})**`)
        .addFields(
          { name: 'Duration',     value: this.current.duration,    inline: true },
          { name: 'Requested by', value: this.current.requestedBy, inline: true },
        );
      this.textChannel.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      console.error(`[Music] Failed to play "${this.current?.title}": ${err.message}`);
      this.textChannel.send(`❌ Failed to play **${this.current?.title ?? 'track'}** — skipping.\n> \`${err.message}\``).catch(() => {});
      this.current = null;
      this._playNext();
    }
  }

  skip()   { this.player.stop(); }
  pause()  { return this.player.pause(); }
  resume() { return this.player.unpause(); }

  stop() {
    this.tracks = [];
    this.loop   = false;
    this.player.stop(true);
    this.destroy();
  }

  destroy() {
    clearTimeout(this.leaveTimer);
    try { this.connection?.destroy(); } catch {}
    queues.delete(this.guildId);
  }
}

function getQueue(guildId)        { return queues.get(guildId) ?? null; }
function setQueue(guildId, queue) { queues.set(guildId, queue); }

module.exports = { MusicQueue, getQueue, setQueue };
