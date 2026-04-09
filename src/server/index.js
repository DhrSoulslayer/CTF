'use strict';

const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const path       = require('path');

const db         = require('./db');
const gameLogic  = require('./gameLogic');
const push       = require('./push');

const app    = express();
const server = http.createServer(app);
app.set('trust proxy', true);

// ── WebSocket server (path-based upgrade) ─────────────────────────────────────
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });

  if (data?.type === 'capture') {
    notifyTeamLostTerritory(data).catch(err => {
      console.error('Push notify failed:', err.message);
    });
  }
  if (data?.type === 'capture_blocked' && data?.reason === 'insufficient_credits') {
    notifyInsufficientCredits(data).catch(err => {
      console.error('Push notify failed:', err.message);
    });
  }
}

async function notifyTeamLostTerritory(captureEvent) {
  if (!push.isEnabled()) return;
  if (!captureEvent?.prevTeam || captureEvent.prevTeam === 'Neutral') return;
  if (captureEvent.prevTeam === captureEvent.team) return;

  const subscriptions = db.getPushSubscriptionsByTeam(captureEvent.prevTeam);
  if (!subscriptions.length) return;

  const payload = {
    title: 'Gebied verloren',
    body: `${captureEvent.prevTeam} is ${captureEvent.geofenceName} kwijt aan ${captureEvent.team}`,
    url: '/pub/',
  };

  for (const sub of subscriptions) {
    const result = await push.sendPush(sub, payload);
    if (!result.ok && result.shouldDelete) {
      db.deletePushSubscription(sub.endpoint);
    }
  }
}

async function notifyInsufficientCredits(blockedEvent) {
  if (!push.isEnabled()) return;
  const team = String(blockedEvent?.team || '').trim();
  if (!team || team === 'Neutral') return;

  const subscriptions = db.getPushSubscriptionsByTeam(team);
  if (!subscriptions.length) return;

  const remaining = Math.max(0, Math.round(Number(blockedEvent?.teamCredits?.[team]) || 0));
  const cost = Math.max(0, Math.round(Number(blockedEvent?.creditCost) || 0));
  const payload = {
    title: 'Onvoldoende credits',
    body: `${team} kan ${blockedEvent.geofenceName} niet claimen: kost ${cost}, saldo ${remaining}`,
    url: '/pub/',
  };

  for (const sub of subscriptions) {
    const result = await push.sendPush(sub, payload);
    if (!result.ok && result.shouldDelete) {
      db.deletePushSubscription(sub.endpoint);
    }
  }
}

function buildSnapshot() {
  return {
    type:      'snapshot',
    geofences: db.getAllGeofences(),
    positions: db.getAllPositions(),
    scores:    db.getAllScores(),
    teamCredits: db.getAllTeamCredits(),
    owners:    db.getAllOwners(),
    occupancyMs: db.getOccupancyTotals(),
    occupancyByTerritory: db.getOccupancyByGeofence(),
    mapDefault: db.getMapDefaultView(),
    teams:     gameLogic.getTeamConfig().teams,
    teamColors: gameLogic.getTeamColors(),
    game:      {
      status: gameLogic.getGameStatus(),
      mode: gameLogic.getGameMode(),
      captureHoldMs: gameLogic.getCaptureHoldMs(),
      initialTeamCredits: db.getInitialTeamCredits(),
    },
  };
}

wss.on('connection', ws => {
  // Send full snapshot on connect / reconnect
  const snapshot = buildSnapshot();
  ws.send(JSON.stringify(snapshot));
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());

// ── Basic auth middleware ─────────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';

function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="CTF Admin"');
    return res.status(401).send('Unauthorized');
  }
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
  const colon   = decoded.indexOf(':');
  const user    = decoded.slice(0, colon);
  const pass    = decoded.slice(colon + 1);
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="CTF Admin"');
    return res.status(401).send('Unauthorized');
  }
  next();
}

function requireAdminPageRequest(req, res, next) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol;
  const host = forwardedHost || req.headers.host;
  const expectedOrigin = `${proto}://${host}`;
  const refererRaw = req.headers.referer || '';
  const originRaw = req.headers.origin || '';

  if (!host) {
    return res.status(403).json({ error: 'Missing host header' });
  }

  if (!refererRaw && !originRaw) {
    return res.status(403).json({ error: 'Admin page origin/referer is required' });
  }

  if (refererRaw) {
    try {
      const referer = new URL(refererRaw);
      const refererOrigin = `${referer.protocol}//${referer.host}`;
      if (refererOrigin !== expectedOrigin || !referer.pathname.startsWith('/admin')) {
        return res.status(403).json({ error: 'Request must come from the admin page' });
      }
      return next();
    } catch {
      return res.status(403).json({ error: 'Invalid referer header' });
    }
  }

  try {
    const origin = new URL(originRaw);
    const originValue = `${origin.protocol}//${origin.host}`;
    if (originValue !== expectedOrigin) {
      return res.status(403).json({ error: 'Request origin is not allowed' });
    }
  } catch {
    return res.status(403).json({ error: 'Invalid origin header' });
  }

  next();
}

// ── Static files ──────────────────────────────────────────────────────────────
app.use('/lib',   express.static(path.join(__dirname, '../web/lib')));
app.use('/pub',   express.static(path.join(__dirname, '../web/pub')));
app.use('/admin', adminAuth, express.static(path.join(__dirname, '../web/admin')));
app.get('/manifest.webmanifest', (_req, res) => {
  res.sendFile(path.join(__dirname, '../web/pub/manifest.webmanifest'));
});
app.get('/sw.js', (_req, res) => {
  res.sendFile(path.join(__dirname, '../web/pub/sw.js'));
});

// ── Root redirect ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.redirect('/pub'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

// ── Snapshot API ──────────────────────────────────────────────────────────────
app.get('/api/state', (_req, res) => {
  const snapshot = buildSnapshot();
  delete snapshot.type;
  res.json(snapshot);
});

app.get('/api/game', (_req, res) => {
  res.json({
    status: gameLogic.getGameStatus(),
    mode: gameLogic.getGameMode(),
    captureHoldMs: gameLogic.getCaptureHoldMs(),
    initialTeamCredits: db.getInitialTeamCredits(),
    teamCredits: db.getAllTeamCredits(),
  });
});

app.get('/api/push/public-key', (_req, res) => {
  res.json({ enabled: push.isEnabled(), publicKey: push.getPublicKey() || null });
});

app.post('/api/push/subscribe', (req, res) => {
  if (!push.isEnabled()) {
    return res.status(503).json({ error: 'push is not configured on server' });
  }
  try {
    const teamInput = String(req.body?.team || '').trim();
    const configuredTeams = gameLogic.getTeamConfig().teams.map(t => String(t.name || '').trim()).filter(Boolean);
    const team = configuredTeams.find(t => t.toLowerCase() === teamInput.toLowerCase()) || '';
    if (!team) {
      return res.status(400).json({ error: 'invalid team for push subscription' });
    }

    const subInput = (req.body && typeof req.body.subscription === 'object' && req.body.subscription)
      ? req.body.subscription
      : req.body;
    const normalizedSubscription = {
      endpoint: String(subInput?.endpoint || '').trim(),
      keys: {
        p256dh: String(subInput?.keys?.p256dh || '').trim(),
        auth: String(subInput?.keys?.auth || '').trim(),
      },
    };

    const endpoint = normalizedSubscription.endpoint;
    const existing = db.getPushSubscription(endpoint);
    if (existing && existing.team !== team && gameLogic.getGameStatus() === 'running') {
      return res.status(409).json({ error: 'team switching is not allowed while game is running' });
    }

    db.upsertPushSubscription(normalizedSubscription, team);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'invalid subscription payload', code: 'push_subscribe_invalid_payload' });
  }
});

app.post('/api/push/unsubscribe', (req, res) => {
  const endpoint = req.body?.endpoint;
  db.deletePushSubscription(endpoint);
  res.json({ ok: true });
});

app.get('/api/admin/teams', adminAuth, requireAdminPageRequest, (_req, res) => {
  res.json(gameLogic.getTeamConfig());
});

app.put('/api/admin/teams', adminAuth, requireAdminPageRequest, (req, res) => {
  try {
    const config = gameLogic.setTeamConfig(req.body || {});
    const snapshot = buildSnapshot();
    broadcast(snapshot);
    res.json(config);
  } catch (err) {
    res.status(400).json({ error: err.message || 'invalid team config' });
  }
});

app.get('/api/admin/scores', adminAuth, requireAdminPageRequest, (_req, res) => {
  res.json({
    scores: db.getAllScores(),
    teamCredits: db.getAllTeamCredits(),
    owners: db.getAllOwners(),
    occupancyMs: db.getOccupancyTotals(),
    occupancyByTerritory: db.getOccupancyByGeofence(),
  });
});

app.get('/api/admin/history', adminAuth, requireAdminPageRequest, (req, res) => {
  const limit = Number(req.query?.limit);
  res.json({ rounds: db.getRoundHistoryList(limit) });
});

app.get('/api/admin/history/:id', adminAuth, requireAdminPageRequest, (req, res) => {
  const round = db.getRoundHistoryById(req.params.id);
  if (!round) {
    return res.status(404).json({ error: 'round not found' });
  }
  res.json(round);
});

app.get('/api/admin/geofences/export', adminAuth, requireAdminPageRequest, (_req, res) => {
  const geofences = db.getAllGeofences().map(gf => ({
    name: gf.name,
    geojson: gf.geojson,
  }));
  res.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    geofences,
  });
});

app.post('/api/admin/geofences/import', adminAuth, requireAdminPageRequest, (req, res) => {
  try {
    const mode = req.body?.mode === 'merge' ? 'merge' : 'replace';
    const result = db.importGeofences(req.body?.geofences || [], mode === 'replace');
    const snapshot = buildSnapshot();
    broadcast(snapshot);
    res.json({ ok: true, mode, imported: result.imported });
  } catch (err) {
    res.status(400).json({ error: err.message || 'invalid geofence import payload' });
  }
});

app.get('/api/admin/settings', adminAuth, requireAdminPageRequest, (_req, res) => {
  res.json({
    mapDefault: db.getMapDefaultView(),
    captureHoldMs: gameLogic.getCaptureHoldMs(),
    initialTeamCredits: db.getInitialTeamCredits(),
    gameMode: gameLogic.getGameMode(),
  });
});

app.put('/api/admin/settings', adminAuth, requireAdminPageRequest, (req, res) => {
  try {
    const updateMapDefault = req.body?.mapDefault !== undefined;
    const updateCaptureHold = req.body?.captureHoldMs !== undefined;
    const updateInitialCredits = req.body?.initialTeamCredits !== undefined;
    const updateGameMode = req.body?.gameMode !== undefined;
    if (!updateMapDefault && !updateCaptureHold && !updateInitialCredits && !updateGameMode) {
      return res.status(400).json({ error: 'nothing to update' });
    }

    let mapDefault = db.getMapDefaultView();
    if (updateMapDefault) {
      mapDefault = db.setMapDefaultView(req.body?.mapDefault || {});
    }

    let captureHoldMs = gameLogic.getCaptureHoldMs();
    if (updateCaptureHold) {
      if (gameLogic.getGameStatus() === 'running') {
        return res.status(409).json({ error: 'capture hold time can only be changed when game is paused or stopped' });
      }
      captureHoldMs = gameLogic.setCaptureHoldMs(req.body.captureHoldMs);
    }

    let initialTeamCredits = db.getInitialTeamCredits();
    if (updateInitialCredits) {
      if (gameLogic.getGameStatus() === 'running') {
        return res.status(409).json({ error: 'initial team credits can only be changed when game is paused or stopped' });
      }
      initialTeamCredits = db.setInitialTeamCredits(req.body.initialTeamCredits);
    }

    let gameMode = gameLogic.getGameMode();
    if (updateGameMode) {
      if (gameLogic.getGameStatus() !== 'stopped') {
        return res.status(409).json({ error: 'game mode can only be changed when game is stopped' });
      }
      gameMode = gameLogic.setGameMode(req.body.gameMode);
    }

    broadcast({ type: 'settings_update', mapDefault, captureHoldMs, initialTeamCredits, gameMode });
    res.json({ mapDefault, captureHoldMs, initialTeamCredits, gameMode });
  } catch (err) {
    res.status(400).json({ error: err.message || 'invalid settings payload' });
  }
});

app.put('/api/game/status', adminAuth, requireAdminPageRequest, (req, res) => {
  const { status } = req.body;
  if (!['running', 'paused', 'stopped'].includes(status)) {
    return res.status(400).json({ error: 'status must be running, paused, or stopped' });
  }

  const prevStatus = gameLogic.getGameStatus();
  const nowIso = new Date().toISOString();
  let savedRoundId = null;

  if (prevStatus === 'stopped' && status === 'running') {
    const mode = gameLogic.getGameMode();
    if (!['wait', 'credits'].includes(mode)) {
      return res.status(409).json({ error: 'choose a game mode before starting a round' });
    }
    // New round starts: reset scores only.
    db.resetScores();
    if (mode === 'credits') {
      const teamNames = gameLogic.getTeamConfig().teams.map(team => team.name);
      db.initializeTeamCredits(teamNames, db.getInitialTeamCredits());
    } else {
      db.clearTeamCredits();
    }
    db.setCurrentRoundStartedAt(nowIso);
  }

  if (status === 'stopped' && prevStatus !== 'stopped') {
    const startedAt = db.getCurrentRoundStartedAt() || nowIso;
    savedRoundId = db.saveRoundHistory({
      startedAt,
      endedAt: nowIso,
      endedReason: 'stopped',
      gameMode: gameLogic.getGameMode(),
      finalScores: db.getAllScores(),
      finalCredits: db.getAllTeamCredits(),
      finalOwners: db.getAllOwners(),
      geofences: db.getAllGeofences(),
    });
    db.setCurrentRoundStartedAt('');
  }

  const nextStatus = gameLogic.setGameStatus(status);
  const snapshot = buildSnapshot();
  broadcast(snapshot);
  res.json({ status: nextStatus, savedRoundId });
});

app.post('/api/game/reset', adminAuth, requireAdminPageRequest, (_req, res) => {
  gameLogic.resetGame();
  const snapshot = buildSnapshot();
  broadcast(snapshot);
  res.json({ ok: true, game: snapshot.game });
});

// ── Traccar webhook ───────────────────────────────────────────────────────────
app.post('/traccar', (req, res) => {
  res.sendStatus(200); // respond quickly
  try {
    gameLogic.handlePosition(req.body, broadcast);
  } catch (err) {
    console.error('Error handling Traccar position:', err);
  }
});

// ── Geofence REST API ─────────────────────────────────────────────────────────
app.get('/api/geofences', (_req, res) => {
  res.json(db.getAllGeofences());
});

app.post('/api/geofences', adminAuth, requireAdminPageRequest, (req, res) => {
  const { name, geojson } = req.body;
  if (!name || !geojson) {
    return res.status(400).json({ error: 'name and geojson are required' });
  }
  db.upsertGeofence(name, geojson);
  const geofence = db.getGeofence(name);
  broadcast({ type: 'geofence_update', geofence });
  res.status(201).json(geofence);
});

app.put('/api/geofences/:name', adminAuth, requireAdminPageRequest, (req, res) => {
  const { name }               = req.params;
  const { geojson, newName }   = req.body;

  if (newName && newName !== name) {
    // Rename (optionally also update geometry)
    db.renameGeofence(name, newName, geojson || undefined);
    const geofence = db.getGeofence(newName);
    broadcast({ type: 'geofence_delete', name });
    broadcast({ type: 'geofence_update', geofence });
    return res.json(geofence);
  }

  if (!geojson) return res.status(400).json({ error: 'geojson is required' });
  db.upsertGeofence(name, geojson);
  const geofence = db.getGeofence(name);
  broadcast({ type: 'geofence_update', geofence });
  res.json(geofence);
});

app.delete('/api/geofences/:name', adminAuth, requireAdminPageRequest, (req, res) => {
  const { name } = req.params;
  db.deleteGeofence(name);
  broadcast({ type: 'geofence_delete', name });
  res.json({ deleted: name });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3456;
server.listen(PORT, () => {
  console.log(`CTF server listening on port ${PORT}`);
});
