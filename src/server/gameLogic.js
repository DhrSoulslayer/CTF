'use strict';

const path = require('path');
const fs = require('fs');
const db = require('./db');

// ── Team colours ──────────────────────────────────────────────────────────────
const TEAM_COLORS = {
  Alfa:    '#e6194B',
  Bravo:   '#3cb44b',
  Charlie: '#ffe119',
  Delta:   '#4363d8',
  Echo:    '#f58231',
  Foxtrot: '#911eb4',
  Juliet:  '#46f0f0',
  India:   '#fabed4',
  Neutral: '#808080',
};

const VALID_GAME_STATES = new Set(['running', 'paused', 'stopped']);
let gameStatus = db.getGameStatus();

// ── Device → team mapping ─────────────────────────────────────────────────────
let deviceTeams = {};
const teamsFile = path.join(__dirname, '../shared/teams.json');
try {
  const raw = fs.readFileSync(teamsFile, 'utf-8');
  deviceTeams = JSON.parse(raw).devices || {};
  console.log(`Loaded ${Object.keys(deviceTeams).length} device→team mappings`);
} catch (e) {
  console.warn('Could not load teams.json:', e.message);
}

// ── In-memory capture state ───────────────────────────────────────────────────
// Key: "<deviceId>::<geofenceName>"  →  { enteredAt: ms|null, triggered: bool }
const geofenceState = {};

function clearGeofenceState() {
  Object.keys(geofenceState).forEach(key => delete geofenceState[key]);
}

function getGameStatus() {
  return gameStatus;
}

function setGameStatus(status) {
  if (!VALID_GAME_STATES.has(status)) {
    throw new Error('invalid game status');
  }
  gameStatus = status;
  db.setGameStatus(status);
  if (status === 'stopped') {
    clearGeofenceState();
  }
  return gameStatus;
}

function resetGame() {
  db.resetGameProgress();
  clearGeofenceState();
}

// Small epsilon prevents division by zero when two ring vertices share the same latitude.
const EPSILON = 1e-12;
// ── Point-in-polygon (ray-casting, GeoJSON coords: [lon, lat]) ────────────────
function pointInPolygon(lat, lon, coordinates) {
  const ring = coordinates[0]; // outer ring only
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]; // lon, lat
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi || EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ── Main handler ──────────────────────────────────────────────────────────────
function handlePosition(payload, broadcast) {
  const deviceId = String(
    payload?.device?.uniqueId ?? payload?.device?.id ?? 'unknown'
  );
  const name = payload?.device?.name || deviceId;
  const lat  = Number(payload?.position?.latitude);
  const lon  = Number(payload?.position?.longitude);

  if (!isFinite(lat) || !isFinite(lon)) return;

  const rawTime  = payload?.device?.lastUpdate || payload?.position?.serverTime || null;
  const timestamp = rawTime ? new Date(rawTime).toISOString() : new Date().toISOString();
  const now       = rawTime ? new Date(rawTime).getTime()     : Date.now();

  // Persist & broadcast position
  db.upsertPosition(deviceId, name, lat, lon, timestamp);
  broadcast({ type: 'position', deviceId, name, lat, lon, timestamp });

  // Geofence capture check only while game is actively running.
  if (gameStatus !== 'running') return;

  // Geofence capture check
  const geofences = db.getAllGeofences();
  const team = deviceTeams[deviceId] || 'Neutral';

  for (const geofence of geofences) {
    if (!geofence.geojson || !Array.isArray(geofence.geojson.coordinates)) continue;

    const inside = pointInPolygon(lat, lon, geofence.geojson.coordinates);
    const key    = `${deviceId}::${geofence.name}`;
    let   state  = geofenceState[key] || { enteredAt: null, triggered: false };

    if (inside) {
      if (state.enteredAt === null) {
        state = { enteredAt: now, triggered: false };
      }

      const heldMs = now - state.enteredAt;

      if (!state.triggered && heldMs >= 30_000) {
        state.triggered = true;

        // Apply capture
        const prevOwner = geofence.owner;
        db.updateGeofenceOwner(geofence.name, team);
        if (prevOwner !== team) {
          db.incrementScore(team);
        }

        broadcast({
          type:         'capture',
          geofenceName: geofence.name,
          team,
          prevTeam:     prevOwner,
          color:        TEAM_COLORS[team] || TEAM_COLORS.Neutral,
          deviceId,
          deviceName:   name,
          scores:       db.getAllScores(),
          owners:       db.getAllOwners(),
        });
      }
    } else {
      state = { enteredAt: null, triggered: false };
    }

    geofenceState[key] = state;
  }
}

module.exports = {
  handlePosition,
  TEAM_COLORS,
  getGameStatus,
  setGameStatus,
  resetGame,
};
