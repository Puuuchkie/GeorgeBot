'use strict';

const crypto  = require('crypto');
const express = require('express');
const router  = express.Router();

function timingSafe(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function requireAuth(req, res, next) {
  if (req.session?.authed) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  return res.redirect('/login');
}

router.get('/login', (req, res) => {
  if (req.session?.authed) return res.redirect('/');
  res.sendFile(require('path').join(__dirname, '../../..', 'webui/public/login.html'));
});

router.post('/api/login', express.json(), (req, res) => {
  const pw = process.env.WEBUI_PASSWORD;
  if (!pw) return res.status(503).json({ error: 'WEBUI_PASSWORD not set' });
  if (timingSafe(req.body.password || '', pw)) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Wrong password' });
});

router.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = { router, requireAuth };
