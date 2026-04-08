'use strict';

const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const path       = require('path');

const db         = require('./db');
const gameLogic  = require('./gameLogic');

const app    = express();
const server = http.createServer(app);

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
}

function buildSnapshot() {
  return {
    type:      'snapshot',
    geofences: db.getAllGeofences(),
    positions: db.getAllPositions(),
    scores:    db.getAllScores(),
    owners:    db.getAllOwners(),
    occupancyMs: db.getOccupancyTotals(),
    occupancyByTerritory: db.getOccupancyByGeofence(),
    mapDefault: db.getMapDefaultView(),
    teams:     gameLogic.getTeamConfig().teams,
    teamColors: gameLogic.getTeamColors(),
    game:      { status: gameLogic.getGameStatus() },
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
  const host = req.headers.host;
  const expectedOrigin = `${req.protocol}://${host}`;
  const refererRaw = req.headers.referer || '';

  if (!refererRaw) {
    return res.status(403).json({ error: 'Admin page referer is required' });
  }

  try {
    const referer = new URL(refererRaw);
    const refererOrigin = `${referer.protocol}//${referer.host}`;
    if (refererOrigin !== expectedOrigin || !referer.pathname.startsWith('/admin')) {
      return res.status(403).json({ error: 'Request must come from the admin page' });
    }
  } catch {
    return res.status(403).json({ error: 'Invalid referer header' });
  }

  next();
}

// ── Static files ──────────────────────────────────────────────────────────────
app.use('/lib',   express.static(path.join(__dirname, '../web/lib')));
app.use('/pub',   express.static(path.join(__dirname, '../web/pub')));
app.use('/admin', adminAuth, express.static(path.join(__dirname, '../web/admin')));

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
  res.json({ status: gameLogic.getGameStatus() });
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
    owners: db.getAllOwners(),
    occupancyMs: db.getOccupancyTotals(),
    occupancyByTerritory: db.getOccupancyByGeofence(),
  });
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
  res.json({ mapDefault: db.getMapDefaultView() });
});

app.put('/api/admin/settings', adminAuth, requireAdminPageRequest, (req, res) => {
  try {
    const mapDefault = db.setMapDefaultView(req.body?.mapDefault || {});
    broadcast({ type: 'settings_update', mapDefault });
    res.json({ mapDefault });
  } catch (err) {
    res.status(400).json({ error: err.message || 'invalid settings payload' });
  }
});

app.put('/api/game/status', adminAuth, requireAdminPageRequest, (req, res) => {
  const { status } = req.body;
  if (!['running', 'paused', 'stopped'].includes(status)) {
    return res.status(400).json({ error: 'status must be running, paused, or stopped' });
  }
  const nextStatus = gameLogic.setGameStatus(status);
  broadcast({ type: 'game_status', status: nextStatus });
  res.json({ status: nextStatus });
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
