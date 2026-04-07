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

wss.on('connection', ws => {
  // Send full snapshot on connect / reconnect
  const snapshot = {
    type:      'snapshot',
    geofences: db.getAllGeofences(),
    positions: db.getAllPositions(),
    scores:    db.getAllScores(),
    owners:    db.getAllOwners(),
  };
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
  res.json({
    geofences: db.getAllGeofences(),
    positions: db.getAllPositions(),
    scores:    db.getAllScores(),
    owners:    db.getAllOwners(),
  });
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

app.post('/api/geofences', adminAuth, (req, res) => {
  const { name, geojson } = req.body;
  if (!name || !geojson) {
    return res.status(400).json({ error: 'name and geojson are required' });
  }
  db.upsertGeofence(name, geojson);
  const geofence = db.getGeofence(name);
  broadcast({ type: 'geofence_update', geofence });
  res.status(201).json(geofence);
});

app.put('/api/geofences/:name', adminAuth, (req, res) => {
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

app.delete('/api/geofences/:name', adminAuth, (req, res) => {
  const { name } = req.params;
  db.deleteGeofence(name);
  broadcast({ type: 'geofence_delete', name });
  res.json({ deleted: name });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`CTF server listening on port ${PORT}`);
});
