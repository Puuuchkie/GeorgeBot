'use strict';

const { createCanvas, loadImage } = require('canvas');
const fetch = require('node-fetch');

const W = 800, H = 250;
const AVATAR_X = 125, AVATAR_Y = 125, AVATAR_R = 80;
const TEXT_X = 240;

const THEME = {
  welcome: { bg1: '#1a1a2e', bg2: '#16213e', accent: '#5865f2', label: 'Welcome!' },
  goodbye: { bg1: '#1c1c1c', bg2: '#2a2a2a', accent: '#888888', label: 'Goodbye.' },
};

async function generateCard(member, guild, type = 'welcome') {
  const theme  = THEME[type] ?? THEME.welcome;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // Background
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, theme.bg1);
  grad.addColorStop(1, theme.bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Border
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, W - 4, H - 4);

  // Avatar ring
  ctx.beginPath();
  ctx.arc(AVATAR_X, AVATAR_Y, AVATAR_R + 6, 0, Math.PI * 2);
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Avatar
  try {
    const url    = member.user.displayAvatarURL({ extension: 'png', size: 256 });
    const res    = await fetch(url);
    const buf    = await res.buffer();
    const img    = await loadImage(buf);
    ctx.save();
    ctx.beginPath();
    ctx.arc(AVATAR_X, AVATAR_Y, AVATAR_R, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, AVATAR_X - AVATAR_R, AVATAR_Y - AVATAR_R, AVATAR_R * 2, AVATAR_R * 2);
    ctx.restore();
  } catch { /* avatar failed — leave blank circle */ }

  // Divider line
  ctx.strokeStyle = theme.accent + '55';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(TEXT_X - 10, 30);
  ctx.lineTo(TEXT_X - 10, H - 30);
  ctx.stroke();

  // Title
  ctx.font = 'bold 40px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(theme.label, TEXT_X, 85);

  // Username
  const name = member.user.username;
  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = theme.accent;
  ctx.fillText(name.length > 24 ? name.slice(0, 22) + '…' : name, TEXT_X, 133);

  // Server + member count
  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#aaaaaa';
  const action = type === 'welcome' ? 'joined' : 'left';
  ctx.fillText(`${action} ${guild.name}`, TEXT_X, 170);

  ctx.font = '17px sans-serif';
  ctx.fillStyle = '#666666';
  ctx.fillText(`Member #${guild.memberCount}`, TEXT_X, 200);

  return canvas.toBuffer('image/png');
}

module.exports = { generateCard };
