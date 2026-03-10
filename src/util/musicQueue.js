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

    try {
      const stream   = await play.stream(this.current.url);
      const resource = createAudioResource(stream.stream, { inputType: stream.type });
      this.player.play(resource);

      logAction('music', `Now playing: ${this.current.title} [${this.current.duration}] — requested by ${this.current.requestedBy}`);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎵 Now Playing')
        .setDescription(`**[${this.current.title}](${this.current.url})**`)
        .addFields(
          { name: 'Duration',    value: this.current.duration, inline: true },
          { name: 'Requested by', value: `${this.current.requestedBy}`, inline: true },
        );
      this.textChannel.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      console.error('[Music] Stream error:', err.message);
      this.textChannel.send(`❌ Failed to play **${this.current.title}**. Skipping…`).catch(() => {});
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
