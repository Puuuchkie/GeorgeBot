'use strict';

require('./logger');  // patch console.* before anything else

const http           = require('http');
const path           = require('path');
const express        = require('express');
const session        = require('express-session');
const cookieParser   = require('cookie-parser');
const { WebSocketServer } = require('ws');
const { router: authRouter, requireAuth } = require('./routes/auth');
const apiRouter      = require('./routes/api');
const { ring, subscribers } = require('./logger');

function startWebUI(client) {
  const pw   = process.env.WEBUI_PASSWORD;
  const port = parseInt(process.env.WEBUI_PORT || '3000', 10);

  if (!pw) {
    console.warn('[WebUI] WEBUI_PASSWORD is not set — web UI disabled.');
    return;
  }

  const secret = process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex');

  const app = express();

  app.use(cookieParser());
  app.use(session({
    secret,
    resave:            false,
    saveUninitialized: false,
    cookie:            { maxAge: 86_400_000 },
  }));

  // Auth routes (login page + login/logout API — no auth required)
  app.use(authRouter);

  // Everything below requires auth
  app.use(requireAuth);

  // REST API
  app.use('/api', apiRouter(client));

  // Static SPA
  const PUBLIC = path.join(__dirname, '../../webui/public');
  app.use(express.static(PUBLIC));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

  const server = http.createServer(app);

  // WebSocket live logs
  const wss = new WebSocketServer({ server, path: '/ws/logs' });

  wss.on('connection', (ws, req) => {
    // Validate session on upgrade
    const sessionMiddleware = session({
      secret,
      resave:            false,
      saveUninitialized: false,
    });
    sessionMiddleware(req, {}, () => {
      if (!req.session?.authed) return ws.close(4401, 'Unauthorized');
      subscribers.add(ws);
      // Replay recent log history
      for (const entry of ring) {
        if (ws.readyState === 1) ws.send(JSON.stringify(entry));
      }
      ws.on('close', () => subscribers.delete(ws));
    });
  });

  server.listen(port, () => {
    console.log(`[WebUI] Running on http://localhost:${port}`);
  });
}

module.exports = { startWebUI };
