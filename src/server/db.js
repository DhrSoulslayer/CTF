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
const DEFAULT_MAP_VIEW = { lat: 52.1326, lon: 5.2913, zoom: 8 };

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

  CREATE TABLE IF NOT EXISTS occupancy_totals (
    team      TEXT PRIMARY KEY,
    total_ms  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS occupancy_by_geofence (
    geofence  TEXT NOT NULL,
    team      TEXT NOT NULL,
    total_ms  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (geofence, team)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
`);

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

ensureColumn('geofences', 'owner_since', "TEXT NOT NULL DEFAULT ''");
db.prepare(`
  UPDATE geofences
  SET owner_since = COALESCE(NULLIF(owner_since, ''), updated_at, ?)
  WHERE owner_since IS NULL OR owner_since = ''
`).run(new Date().toISOString());

db.prepare(`
  INSERT INTO game_state (id, status, updated_at)
  VALUES (1, 'running', ?)
  ON CONFLICT(id) DO NOTHING
`).run(new Date().toISOString());

db.prepare(`
  INSERT INTO app_settings (key, value)
  VALUES ('map_default_view', ?)
  ON CONFLICT(key) DO NOTHING
`).run(JSON.stringify(DEFAULT_MAP_VIEW));

function normalizeMapView(input) {
  const lat = Number(input?.lat);
  const lon = Number(input?.lon);
  const zoom = Number(input?.zoom);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error('invalid map view: lat must be between -90 and 90');
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error('invalid map view: lon must be between -180 and 180');
  }
  if (!Number.isFinite(zoom) || zoom < 1 || zoom > 19) {
    throw new Error('invalid map view: zoom must be between 1 and 19');
  }
  return {
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    zoom: Number(zoom.toFixed(2)),
  };
}

function normalizeImportedGeofence(row, index) {
  const fallbackName = `Territory-${index + 1}`;
  const name = String(row?.name || fallbackName).trim();
  const geojson = row?.geojson;
  if (!name) throw new Error('invalid geofence import: name is required');
  if (!geojson || geojson.type !== 'Polygon' || !Array.isArray(geojson.coordinates)) {
    throw new Error(`invalid geofence import for ${name}: geojson polygon is required`);
  }
  return { name, geojson };
}

module.exports = {
  getMapDefaultView() {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'map_default_view'").get();
    if (!row?.value) return { ...DEFAULT_MAP_VIEW };
    try {
      return normalizeMapView(JSON.parse(row.value));
    } catch {
      return { ...DEFAULT_MAP_VIEW };
    }
  },

  setMapDefaultView(view) {
    const normalized = normalizeMapView(view);
    db.prepare(`
      INSERT INTO app_settings (key, value)
      VALUES ('map_default_view', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(normalized));
    return normalized;
  },

  importGeofences(geofences, replaceExisting = true) {
    if (!Array.isArray(geofences)) {
      throw new Error('invalid geofence import: geofences must be an array');
    }

    const seen = new Set();
    const normalized = geofences.map((row, idx) => {
      const gf = normalizeImportedGeofence(row, idx);
      if (seen.has(gf.name)) {
        throw new Error(`invalid geofence import: duplicate name ${gf.name}`);
      }
      seen.add(gf.name);
      return gf;
    });

    const now = new Date().toISOString();
    const upsert = db.prepare(`
      INSERT INTO geofences (name, geojson, owner, owner_since, updated_at)
      VALUES (?, ?, 'Neutral', ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        geojson = excluded.geojson,
        owner = 'Neutral',
        owner_since = excluded.owner_since,
        updated_at = excluded.updated_at
    `);

    db.transaction(() => {
      if (replaceExisting) {
        db.prepare('DELETE FROM geofences').run();
        db.prepare('DELETE FROM occupancy_by_geofence').run();
      }
      normalized.forEach(gf => {
        upsert.run(gf.name, JSON.stringify(gf.geojson), now, now);
      });
    })();

    return {
      imported: normalized.length,
      geofences: this.getAllGeofences(),
    };
  },

  getAllGeofences() {
    return db.prepare('SELECT * FROM geofences ORDER BY name').all().map(row => ({
      name: row.name,
      geojson: JSON.parse(row.geojson),
      owner: row.owner,
      ownerSince: row.owner_since,
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
      ownerSince: row.owner_since,
      updatedAt: row.updated_at,
    };
  },

  upsertGeofence(name, geojson) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO geofences (name, geojson, owner, owner_since, updated_at)
      VALUES (?, ?, 'Neutral', ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        geojson    = excluded.geojson,
        updated_at = excluded.updated_at
    `).run(name, JSON.stringify(geojson), now, now);
  },

  updateGeofenceOwner(name, owner) {
    db.prepare(
      'UPDATE geofences SET owner = ?, owner_since = ?, updated_at = ? WHERE name = ?'
    ).run(owner, new Date().toISOString(), new Date().toISOString(), name);
  },

  transferGeofenceOwner(name, nextOwner, atIso) {
    const nowIso = atIso || new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const row = db.prepare('SELECT owner, owner_since FROM geofences WHERE name = ?').get(name);
    if (!row) return null;

    const prevOwner = row.owner;
    if (prevOwner === nextOwner) {
      return { changed: false, prevOwner, nextOwner };
    }

    const prevSinceMs = Date.parse(row.owner_since || '');
    const heldMs = Number.isFinite(prevSinceMs) && Number.isFinite(nowMs)
      ? Math.max(0, nowMs - prevSinceMs)
      : 0;

    const tx = db.transaction(() => {
      if (heldMs > 0) {
        db.prepare(`
          INSERT INTO occupancy_totals (team, total_ms) VALUES (?, ?)
          ON CONFLICT(team) DO UPDATE SET total_ms = total_ms + excluded.total_ms
        `).run(prevOwner, heldMs);

        db.prepare(`
          INSERT INTO occupancy_by_geofence (geofence, team, total_ms) VALUES (?, ?, ?)
          ON CONFLICT(geofence, team) DO UPDATE SET total_ms = total_ms + excluded.total_ms
        `).run(name, prevOwner, heldMs);
      }

      db.prepare(
        'UPDATE geofences SET owner = ?, owner_since = ?, updated_at = ? WHERE name = ?'
      ).run(nextOwner, nowIso, nowIso, name);
    });
    tx();

    return { changed: true, prevOwner, nextOwner, heldMs };
  },

  deleteGeofence(name) {
    db.transaction(() => {
      db.prepare('DELETE FROM geofences WHERE name = ?').run(name);
      db.prepare('DELETE FROM occupancy_by_geofence WHERE geofence = ?').run(name);
    })();
  },

  renameGeofence(oldName, newName, newGeojson) {
    const old = db.prepare('SELECT * FROM geofences WHERE name = ?').get(oldName);
    if (!old) return;
    const geojson = newGeojson ? JSON.stringify(newGeojson) : old.geojson;
    db.transaction(() => {
      db.prepare('DELETE FROM geofences WHERE name = ?').run(oldName);
      db.prepare(`
        INSERT INTO geofences (name, geojson, owner, owner_since, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(newName, geojson, old.owner, old.owner_since, new Date().toISOString());

      const rows = db.prepare('SELECT team, total_ms FROM occupancy_by_geofence WHERE geofence = ?').all(oldName);
      rows.forEach(row => {
        db.prepare(`
          INSERT INTO occupancy_by_geofence (geofence, team, total_ms) VALUES (?, ?, ?)
          ON CONFLICT(geofence, team) DO UPDATE SET total_ms = total_ms + excluded.total_ms
        `).run(newName, row.team, row.total_ms);
      });
      db.prepare('DELETE FROM occupancy_by_geofence WHERE geofence = ?').run(oldName);
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

  getOccupancyTotals(nowIso) {
    const nowMs = Date.parse(nowIso || new Date().toISOString());
    const totals = db.prepare('SELECT team, total_ms FROM occupancy_totals').all().reduce((acc, row) => {
      acc[row.team] = Number(row.total_ms) || 0;
      return acc;
    }, {});

    const activeOwners = db.prepare('SELECT owner, owner_since FROM geofences').all();
    activeOwners.forEach(row => {
      const sinceMs = Date.parse(row.owner_since || '');
      if (!Number.isFinite(sinceMs) || !Number.isFinite(nowMs)) return;
      const heldMs = Math.max(0, nowMs - sinceMs);
      totals[row.owner] = (totals[row.owner] || 0) + heldMs;
    });

    return totals;
  },

  getOccupancyByGeofence(nowIso) {
    const nowMs = Date.parse(nowIso || new Date().toISOString());
    const byGeofence = {};

    const persisted = db.prepare('SELECT geofence, team, total_ms FROM occupancy_by_geofence').all();
    persisted.forEach(row => {
      if (!byGeofence[row.geofence]) byGeofence[row.geofence] = {};
      byGeofence[row.geofence][row.team] = Number(row.total_ms) || 0;
    });

    const activeOwners = db.prepare('SELECT name, owner, owner_since FROM geofences').all();
    activeOwners.forEach(row => {
      const sinceMs = Date.parse(row.owner_since || '');
      if (!Number.isFinite(sinceMs) || !Number.isFinite(nowMs)) return;
      const heldMs = Math.max(0, nowMs - sinceMs);
      if (!byGeofence[row.name]) byGeofence[row.name] = {};
      byGeofence[row.name][row.owner] = (byGeofence[row.name][row.owner] || 0) + heldMs;
    });

    return byGeofence;
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
      db.prepare('DELETE FROM occupancy_totals').run();
      db.prepare('DELETE FROM occupancy_by_geofence').run();
      db.prepare("UPDATE geofences SET owner = 'Neutral', owner_since = ?, updated_at = ?").run(now, now);
    })();
  },

  renameTeamReferences(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return;
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('UPDATE geofences SET owner = ?, updated_at = ? WHERE owner = ?')
        .run(newName, now, oldName);

      const oldScore = db.prepare('SELECT score FROM scores WHERE team = ?').get(oldName);
      if (oldScore) {
        db.prepare(`
          INSERT INTO scores (team, score) VALUES (?, ?)
          ON CONFLICT(team) DO UPDATE SET score = score + excluded.score
        `).run(newName, oldScore.score);
        db.prepare('DELETE FROM scores WHERE team = ?').run(oldName);
      }

      const oldOccupancy = db.prepare('SELECT total_ms FROM occupancy_totals WHERE team = ?').get(oldName);
      if (oldOccupancy) {
        db.prepare(`
          INSERT INTO occupancy_totals (team, total_ms) VALUES (?, ?)
          ON CONFLICT(team) DO UPDATE SET total_ms = total_ms + excluded.total_ms
        `).run(newName, oldOccupancy.total_ms);
        db.prepare('DELETE FROM occupancy_totals WHERE team = ?').run(oldName);
      }

      const geofenceRows = db.prepare('SELECT geofence, total_ms FROM occupancy_by_geofence WHERE team = ?').all(oldName);
      geofenceRows.forEach(row => {
        db.prepare(`
          INSERT INTO occupancy_by_geofence (geofence, team, total_ms) VALUES (?, ?, ?)
          ON CONFLICT(geofence, team) DO UPDATE SET total_ms = total_ms + excluded.total_ms
        `).run(row.geofence, newName, row.total_ms);
      });
      db.prepare('DELETE FROM occupancy_by_geofence WHERE team = ?').run(oldName);
    })();
  },
};
