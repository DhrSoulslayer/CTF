'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/app.db');

// Ensure the directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL for better concurrent read performance
db.pragma('journal_mode = WAL');

// Auto-init schema
db.exec(`
  CREATE TABLE IF NOT EXISTS geofences (
    name     TEXT PRIMARY KEY,
    geojson  TEXT NOT NULL,
    owner    TEXT NOT NULL DEFAULT 'Neutral',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS positions (
    device_id  TEXT PRIMARY KEY,
    name       TEXT,
    lat        REAL NOT NULL,
    lon        REAL NOT NULL,
    timestamp  TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scores (
    team   TEXT PRIMARY KEY,
    score  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS game_state (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    status  TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

db.prepare(`
  INSERT INTO game_state (id, status, updated_at)
  VALUES (1, 'running', ?)
  ON CONFLICT(id) DO NOTHING
`).run(new Date().toISOString());

module.exports = {
  getAllGeofences() {
    return db.prepare('SELECT * FROM geofences ORDER BY name').all().map(row => ({
      name: row.name,
      geojson: JSON.parse(row.geojson),
      owner: row.owner,
      updatedAt: row.updated_at,
    }));
  },

  getGeofence(name) {
    const row = db.prepare('SELECT * FROM geofences WHERE name = ?').get(name);
    if (!row) return null;
    return {
      name: row.name,
      geojson: JSON.parse(row.geojson),
      owner: row.owner,
      updatedAt: row.updated_at,
    };
  },

  upsertGeofence(name, geojson) {
    db.prepare(`
      INSERT INTO geofences (name, geojson, owner, updated_at)
      VALUES (?, ?, 'Neutral', ?)
      ON CONFLICT(name) DO UPDATE SET
        geojson    = excluded.geojson,
        updated_at = excluded.updated_at
    `).run(name, JSON.stringify(geojson), new Date().toISOString());
  },

  updateGeofenceOwner(name, owner) {
    db.prepare(
      'UPDATE geofences SET owner = ?, updated_at = ? WHERE name = ?'
    ).run(owner, new Date().toISOString(), name);
  },

  deleteGeofence(name) {
    db.prepare('DELETE FROM geofences WHERE name = ?').run(name);
  },

  renameGeofence(oldName, newName, newGeojson) {
    const old = db.prepare('SELECT * FROM geofences WHERE name = ?').get(oldName);
    if (!old) return;
    const geojson = newGeojson ? JSON.stringify(newGeojson) : old.geojson;
    db.transaction(() => {
      db.prepare('DELETE FROM geofences WHERE name = ?').run(oldName);
      db.prepare(`
        INSERT INTO geofences (name, geojson, owner, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(newName, geojson, old.owner, new Date().toISOString());
    })();
  },

  getAllPositions() {
    const rows = db.prepare('SELECT * FROM positions').all();
    return rows.reduce((acc, row) => {
      acc[row.device_id] = {
        deviceId: row.device_id,
        name: row.name,
        lat: row.lat,
        lon: row.lon,
        timestamp: row.timestamp,
      };
      return acc;
    }, {});
  },

  upsertPosition(deviceId, name, lat, lon, timestamp) {
    db.prepare(`
      INSERT INTO positions (device_id, name, lat, lon, timestamp, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        name       = excluded.name,
        lat        = excluded.lat,
        lon        = excluded.lon,
        timestamp  = excluded.timestamp,
        updated_at = excluded.updated_at
    `).run(deviceId, name, lat, lon, timestamp, new Date().toISOString());
  },

  getAllScores() {
    const rows = db.prepare('SELECT * FROM scores').all();
    return rows.reduce((acc, row) => {
      acc[row.team] = row.score;
      return acc;
    }, {});
  },

  getAllOwners() {
    const rows = db.prepare('SELECT name, owner FROM geofences ORDER BY name').all();
    return rows.reduce((acc, row) => {
      acc[row.name] = row.owner;
      return acc;
    }, {});
  },

  incrementScore(team) {
    db.prepare(`
      INSERT INTO scores (team, score) VALUES (?, 1)
      ON CONFLICT(team) DO UPDATE SET score = score + 1
    `).run(team);
  },

  getGameStatus() {
    const row = db.prepare('SELECT status FROM game_state WHERE id = 1').get();
    return row?.status || 'running';
  },

  setGameStatus(status) {
    db.prepare(
      'UPDATE game_state SET status = ?, updated_at = ? WHERE id = 1'
    ).run(status, new Date().toISOString());
  },

  resetGameProgress() {
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('DELETE FROM positions').run();
      db.prepare('DELETE FROM scores').run();
      db.prepare("UPDATE geofences SET owner = 'Neutral', updated_at = ?").run(now);
    })();
  },
};
