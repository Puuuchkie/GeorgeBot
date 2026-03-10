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
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { spawn }     = require('child_process');
const play          = require('play-dl');
const { logAction } = require('../webui/logger');

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseDuration(str) {
  if (!str || str === 'Live') return 0;
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function formatTime(secs) {
  if (!secs) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function buildProgressBar(elapsed, total, width = 18) {
  if (!total) return '─'.repeat(width);
  const ratio  = Math.min(elapsed / total, 1);
  const filled = Math.round(ratio * width);
  return `\`${'█'.repeat(filled)}${'░'.repeat(width - filled)}\` ${formatTime(elapsed)} / ${formatTime(total)}`;
}

function buildComponents(isPaused, loopOn, volume) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(isPaused ? 'music_resume' : 'music_pause')
      .setLabel(isPaused ? '▶ Resume' : '⏸ Pause')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music_skip')
      .setLabel('⏭ Skip')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music_stop')
      .setLabel('⏹ Stop')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('music_loop')
      .setLabel(loopOn ? '🔁 Loop: On' : '🔁 Loop: Off')
      .setStyle(loopOn ? ButtonStyle.Success : ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music_vol_dn')
      .setLabel('🔉 Vol −')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(volume <= 0),
    new ButtonBuilder()
      .setCustomId('music_vol_up')
      .setLabel('🔊 Vol +')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(volume >= 200),
  );

  return [row1, row2];
}

const queues = new Map();

class MusicQueue {
  constructor(guildId, voiceChannel, textChannel) {
    this.guildId        = guildId;
    this.voiceChannel   = voiceChannel;
    this.textChannel    = textChannel;
    this.tracks         = [];
    this.current        = null;
    this.loop           = false;
    this.volume         = 100; // percent (0–200)
    this.isPaused       = false;
    this.connection     = null;
    this.leaveTimer     = null;
    this.nowPlayingMsg  = null;
    this._progressTimer = null;
    this._resource      = null;
    this.startedAt      = null;
    this.pausedAt       = null;
    this.pausedOffset   = 0;

    this.player = createAudioPlayer();

    this.player.on(AudioPlayerStatus.Idle, () => {
      this._stopProgressUpdater();
      if (this.loop && this.current) this.tracks.unshift(this.current);
      this._playNext();
    });

    this.player.on('error', err => {
      console.error('[Music] Player error:', err.message);
      this._stopProgressUpdater();
      this._playNext();
    });
  }

  // ── Voice connection ────────────────────────────────────────────────────────
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
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.destroy();
      }
    });
  }

  // ── Track management ────────────────────────────────────────────────────────
  async addTrack(track) {
    this.tracks.push(track);
    if (this.player.state.status === AudioPlayerStatus.Idle && !this.current) {
      await this._playNext();
    }
  }

  // ── Streaming: yt-dlp → ffmpeg → PCM (most stable for Discord) ──────────────
  _stream(url) {
    // yt-dlp downloads best audio and pipes to stdout
    const ytdlpArgs = [
      '--format', 'bestaudio',
      '--no-playlist',
      '--quiet',
      '-o', '-',
    ];
    if (process.env.YOUTUBE_COOKIE_FILE) {
      ytdlpArgs.push('--cookies', process.env.YOUTUBE_COOKIE_FILE);
    }
    ytdlpArgs.push(url);

    // ffmpeg transcodes to raw PCM (s16le, 48kHz, stereo) — the most stable
    // format for @discordjs/voice, with no internal re-transcoding.
    const ffmpegArgs = [
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-ac', '2',
      '-ar', '48000',
      '-f', 's16le',
      'pipe:1',
    ];

    const ytdlp  = spawn('yt-dlp',  ytdlpArgs);
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    ytdlp.stdout.pipe(ffmpeg.stdin);
    ytdlp.stderr.on('data', d => console.error('[yt-dlp]', d.toString().trim()));
    ytdlp.on('error', err => console.error('[yt-dlp] error:', err.message));
    ytdlp.on('close', code => {
      if (code !== 0) console.warn(`[yt-dlp] exited with code ${code}`);
      ffmpeg.stdin.end();
    });
    ffmpeg.stderr.on('data', d => console.error('[ffmpeg]', d.toString().trim()));
    ffmpeg.on('error', err => console.error('[ffmpeg] error:', err.message));

    this._resource = createAudioResource(ffmpeg.stdout, {
      inputType:    StreamType.Raw,
      inlineVolume: true,
    });
    this._resource.volume?.setVolume(this.volume / 100);
    return this._resource;
  }

  // ── Volume ──────────────────────────────────────────────────────────────────
  setVolume(percent) {
    this.volume = Math.max(0, Math.min(200, percent));
    this._resource?.volume?.setVolume(this.volume / 100);
  }

  // ── Resolve URL when missing ─────────────────────────────────────────────────
  async _resolveUrl(track) {
    if (typeof track.url === 'string' && track.url.startsWith('http')) return track.url;
    console.warn(`[Music] No URL for "${track.title}" — searching YouTube`);
    const results = await play.search(track.title, { source: { youtube: 'video' }, limit: 1 });
    if (!results.length) throw new Error(`No YouTube results for "${track.title}"`);
    return results[0].url;
  }

  // ── Now Playing embed ────────────────────────────────────────────────────────
  _buildNowPlayingEmbed() {
    const total      = parseDuration(this.current.duration);
    const rawElapsed = this.isPaused
      ? (this.pausedAt  - this.startedAt) / 1000 + this.pausedOffset
      : (Date.now()     - this.startedAt) / 1000 + this.pausedOffset;
    const elapsed = Math.max(0, rawElapsed);

    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎵 Now Playing')
      .setDescription(`**[${this.current.title}](${this.current.url})**\n\n${buildProgressBar(elapsed, total)}`)
      .addFields(
        { name: 'Duration',     value: this.current.duration,                    inline: true },
        { name: 'Requested by', value: this.current.requestedBy,                 inline: true },
        { name: 'Volume',       value: `${this.volume}%`,                        inline: true },
        { name: 'Queue',        value: `${this.tracks.length} track(s) remaining`, inline: true },
      )
      .setFooter({ text: this.loop ? '🔁 Loop enabled' : '─' });
  }

  async _updateNowPlaying() {
    if (!this.nowPlayingMsg) return;
    try {
      await this.nowPlayingMsg.edit({
        embeds:     [this._buildNowPlayingEmbed()],
        components: buildComponents(this.isPaused, this.loop, this.volume),
      });
    } catch { /* message may have been deleted */ }
  }

  _startProgressUpdater() {
    this._stopProgressUpdater();
    this._progressTimer = setInterval(() => {
      if (this.player.state.status === AudioPlayerStatus.Playing) {
        this._updateNowPlaying();
      }
    }, 5_000);
  }

  _stopProgressUpdater() {
    clearInterval(this._progressTimer);
    this._progressTimer = null;
  }

  // ── Playback ─────────────────────────────────────────────────────────────────
  async _playNext() {
    clearTimeout(this.leaveTimer);
    this.nowPlayingMsg = null;
    this._resource     = null;

    if (!this.tracks.length) {
      this.current = null;
      this.leaveTimer = setTimeout(() => this.destroy(), 60_000);
      return;
    }

    this.current      = this.tracks.shift();
    this.isPaused     = false;
    this.startedAt    = null;
    this.pausedAt     = null;
    this.pausedOffset = 0;

    try {
      const url    = await this._resolveUrl(this.current);
      this.current = { ...this.current, url };

      const resource = this._stream(url);
      this.player.play(resource);
      this.startedAt = Date.now();

      logAction('music', `Now playing: ${this.current.title} [${this.current.duration}] — requested by ${this.current.requestedBy}`);

      this.nowPlayingMsg = await this.textChannel.send({
        embeds:     [this._buildNowPlayingEmbed()],
        components: buildComponents(false, this.loop, this.volume),
      }).catch(() => null);

      this._startProgressUpdater();
    } catch (err) {
      console.error(`[Music] Failed to play "${this.current?.title}": ${err.message}`);
      this.textChannel.send(`❌ Failed to play **${this.current?.title ?? 'track'}** — skipping.\n> \`${err.message}\``).catch(() => {});
      this.current = null;
      this._playNext();
    }
  }

  // ── Controls ────────────────────────────────────────────────────────────────
  skip() {
    this._stopProgressUpdater();
    this.player.stop();
  }

  pause() {
    const ok = this.player.pause();
    if (ok) { this.isPaused = true; this.pausedAt = Date.now(); }
    return ok;
  }

  resume() {
    const ok = this.player.unpause();
    if (ok) {
      this.isPaused     = false;
      this.pausedOffset += (Date.now() - (this.pausedAt ?? Date.now())) / 1000;
      this.pausedAt     = null;
    }
    return ok;
  }

  stop() {
    this._stopProgressUpdater();
    this.tracks = [];
    this.loop   = false;
    this.player.stop(true);
    this.destroy();
  }

  destroy() {
    this._stopProgressUpdater();
    clearTimeout(this.leaveTimer);
    try { this.connection?.destroy(); } catch {}
    queues.delete(this.guildId);
  }
}

function getQueue(guildId)        { return queues.get(guildId) ?? null; }
function setQueue(guildId, queue) { queues.set(guildId, queue); }
function getAllQueues()            { return queues; }

module.exports = { MusicQueue, getQueue, setQueue, getAllQueues };
