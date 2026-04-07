'use strict';

const path = require('path');
const fs = require('fs');
const db = require('./db');

// ── Team configuration ────────────────────────────────────────────────────────
const DEFAULT_TEAMS = [
  { name: 'Alfa', color: '#e6194B' },
  { name: 'Bravo', color: '#3cb44b' },
  { name: 'Charlie', color: '#ffe119' },
  { name: 'Delta', color: '#4363d8' },
  { name: 'Echo', color: '#f58231' },
  { name: 'Foxtrot', color: '#911eb4' },
  { name: 'Juliet', color: '#46f0f0' },
  { name: 'India', color: '#fabed4' },
];
const NEUTRAL_TEAM = { name: 'Neutral', color: '#808080' };
const teamsFile = path.join(__dirname, '../shared/teams.json');

let teamConfig = { teams: DEFAULT_TEAMS.slice(), devices: {} };
let teamColors = { [NEUTRAL_TEAM.name]: NEUTRAL_TEAM.color };
let deviceTeams = {};

const VALID_GAME_STATES = new Set(['running', 'paused', 'stopped']);
let gameStatus = db.getGameStatus();

function cloneConfig(config) {
  return {
    teams: config.teams.map(t => ({ name: t.name, color: t.color })),
    devices: { ...config.devices },
  };
}

function normalizeTeamName(name) {
  return String(name || '').trim();
}

function normalizeColor(color) {
  const c = String(color || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return '#808080';
}

function applyTeamConfig(config) {
  teamConfig = cloneConfig(config);
  deviceTeams = { ...teamConfig.devices };
  teamColors = { [NEUTRAL_TEAM.name]: NEUTRAL_TEAM.color };
  teamConfig.teams.forEach(t => {
    teamColors[t.name] = t.color;
  });
}

function readTeamConfigFromDisk() {
  try {
    const raw = fs.readFileSync(teamsFile, 'utf-8');
    const parsed = JSON.parse(raw);

    const parsedTeams = Array.isArray(parsed.teams) && parsed.teams.length
      ? parsed.teams
      : DEFAULT_TEAMS;

    const seen = new Set();
    const teams = parsedTeams
      .map(t => ({
        name: normalizeTeamName(t?.name),
        color: normalizeColor(t?.color),
      }))
      .filter(t => t.name && t.name !== NEUTRAL_TEAM.name && !seen.has(t.name) && seen.add(t.name));

    const validNames = new Set(teams.map(t => t.name));
    const devices = {};
    Object.entries(parsed.devices || {}).forEach(([deviceId, team]) => {
      const id = String(deviceId).trim();
      const teamName = normalizeTeamName(team);
      if (!id) return;
      devices[id] = validNames.has(teamName) ? teamName : NEUTRAL_TEAM.name;
    });

    return {
      teams: teams.length ? teams : DEFAULT_TEAMS.slice(),
      devices,
    };
  } catch (e) {
    console.warn('Could not load teams.json:', e.message);
    return { teams: DEFAULT_TEAMS.slice(), devices: {} };
  }
}

function writeTeamConfigToDisk(config) {
  fs.writeFileSync(teamsFile, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

function getTeamConfig() {
  return cloneConfig(teamConfig);
}

function getTeamColors() {
  return { ...teamColors };
}

function setTeamConfig(nextConfig) {
  if (!nextConfig || !Array.isArray(nextConfig.teams) || typeof nextConfig.devices !== 'object') {
    throw new Error('invalid team config payload');
  }

  const seen = new Set();
  const renames = [];
  const teams = nextConfig.teams.map(row => {
    const name = normalizeTeamName(row?.name);
    const color = normalizeColor(row?.color);
    const originalName = normalizeTeamName(row?.originalName || row?.name);
    if (!name) throw new Error('team name is required');
    if (name === NEUTRAL_TEAM.name) throw new Error('Neutral is a reserved team name');
    if (seen.has(name)) throw new Error(`duplicate team name: ${name}`);
    seen.add(name);
    if (originalName && originalName !== name) {
      renames.push({ oldName: originalName, newName: name });
    }
    return { name, color };
  });

  const validNames = new Set(teams.map(t => t.name));
  const devices = {};
  Object.entries(nextConfig.devices || {}).forEach(([deviceId, team]) => {
    const id = String(deviceId).trim();
    const teamName = normalizeTeamName(team);
    if (!id) return;
    if (!validNames.has(teamName)) {
      throw new Error(`unknown team for device ${id}: ${teamName}`);
    }
    devices[id] = teamName;
  });

  const mergedConfig = { teams, devices };
  renames.forEach(({ oldName, newName }) => {
    db.renameTeamReferences(oldName, newName);
  });
  writeTeamConfigToDisk(mergedConfig);
  applyTeamConfig(mergedConfig);
  console.log(`Loaded ${Object.keys(deviceTeams).length} device→team mappings`);
  return getTeamConfig();
}

applyTeamConfig(readTeamConfigFromDisk());
console.log(`Loaded ${Object.keys(deviceTeams).length} device→team mappings`);

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
          color:        teamColors[team] || teamColors.Neutral,
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
  getTeamColors,
  getTeamConfig,
  setTeamConfig,
  getGameStatus,
  setGameStatus,
  resetGame,
};
