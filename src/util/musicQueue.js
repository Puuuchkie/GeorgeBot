'use strict';

const {
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const play = require('play-dl');
const { EmbedBuilder } = require('discord.js');
const { logAction }    = require('../webui/logger');

// ── YouTube cookie support (set YOUTUBE_COOKIE env var to bypass bot detection)
if (process.env.YOUTUBE_COOKIE) {
  play.setToken({ youtube: { cookie: process.env.YOUTUBE_COOKIE } });
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

  async _playNext() {
    clearTimeout(this.leaveTimer);

    if (!this.tracks.length) {
      this.current = null;
      this.leaveTimer = setTimeout(() => this.destroy(), 60_000);
      return;
    }

    this.current = this.tracks.shift();

    // If the stored URL is missing or invalid, search for it by title
    const isValidUrl = (u) => typeof u === 'string' && u.startsWith('http');
    if (!isValidUrl(this.current.url)) {
      console.warn(`[Music] Invalid URL for "${this.current.title}" (${this.current.url}) — searching by title`);
      try {
        const results = await play.search(this.current.title, { source: { youtube: 'video' }, limit: 1 });
        if (results.length) {
          this.current = { ...this.current, url: results[0].url, duration: results[0].durationRaw ?? '?' };
        } else {
          this.textChannel.send(`❌ Could not find a playable URL for **${this.current.title}** — skipping.`).catch(() => {});
          this.current = null;
          this._playNext();
          return;
        }
      } catch (err) {
        console.error(`[Music] Title search failed: ${err.message}`);
        this.textChannel.send(`❌ Could not find **${this.current.title}** — skipping.`).catch(() => {});
        this.current = null;
        this._playNext();
        return;
      }
    }

    // Try streaming — if the URL fails, search for an alternative
    let stream;
    try {
      stream = await play.stream(this.current.url);
    } catch (err) {
      console.error(`[Music] Stream failed for "${this.current.title}" (${this.current.url}): ${err.message}`);

      // Fallback: search YouTube by title and try other results
      try {
        const results = await play.search(this.current.title, { source: { youtube: 'video' }, limit: 5 });
        const fallback = results.find(v => isValidUrl(v.url) && v.url !== this.current.url);
        if (fallback) {
          console.warn(`[Music] Falling back to: ${fallback.title} (${fallback.url})`);
          this.current = { ...this.current, url: fallback.url, duration: fallback.durationRaw ?? '?' };
          stream = await play.stream(fallback.url);
        }
      } catch (fbErr) {
        console.error(`[Music] Fallback also failed: ${fbErr.message}`);
      }

      if (!stream) {
        this.textChannel.send(`❌ Could not stream **${this.current.title}** — skipping.\n> \`${err.message}\``).catch(() => {});
        this.current = null;
        this._playNext();
        return;
      }
    }

    try {
      const resource = createAudioResource(stream.stream, { inputType: stream.type });
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
      console.error(`[Music] Playback error: ${err.message}`);
      this.textChannel.send(`❌ Playback error for **${this.current.title}** — skipping.`).catch(() => {});
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
