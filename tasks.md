# CTF App – Development Checklist

## Infrastructure
- [x] `Dockerfile` (single container, node:20-alpine)
- [x] `docker-compose.yml` with named volume for `/data`
- [x] `package.json` with `express`, `better-sqlite3`, `ws`

## Backend
- [x] Express HTTP server (`src/server/index.js`)
- [x] SQLite auto-init schema on startup (`src/server/db.js`)
- [x] `POST /traccar` – Traccar webhook (responds 200 immediately, processes async)
- [x] `GET /api/state` – full snapshot (geofences + positions + scores + owners)
- [x] `GET /healthz` – health-check endpoint
- [x] `GET /api/geofences` – list all geofences
- [x] `POST /api/geofences` – create geofence (admin auth)
- [x] `PUT /api/geofences/:name` – update or rename geofence (admin auth)
- [x] `DELETE /api/geofences/:name` – delete geofence (admin auth)
- [x] WebSocket server at `/ws` – real-time broadcast
- [x] Snapshot sent to every new WebSocket client on connect

## Game Logic (`src/server/gameLogic.js`)
- [x] Load device → team mapping from `src/shared/teams.json`
- [x] Ray-casting point-in-polygon (GeoJSON Polygon, EPSG:4326)
- [x] In-memory dwell timers per `(deviceId, geofenceName)`
- [x] Capture triggers after ≥ 30 s continuous dwell
- [x] `owner` column updated on capture
- [x] Score incremented **only** when ownership changes
- [x] Capture event broadcast to all WS clients

## Device → team mapping (`src/shared/teams.json`)
- [x] Example: `15839851` → `Alfa`
- [x] Placeholder IDs for all 8 teams

## Public UI (`/pub`)
- [x] Leaflet map with OSM tiles
- [x] Geofence polygons coloured by owner team
- [x] Tracker markers with name + last-seen tooltip
- [x] Scoreboard pills (one per team, live score)
- [x] Collapsible territory-owners table
- [x] WebSocket auto-updates (snapshot on reconnect)

## Admin UI (`/admin`)
- [x] Basic auth (env `ADMIN_USER` / `ADMIN_PASS`)
- [x] Leaflet map with `Leaflet.draw` polygon tools
- [x] Draw new polygon → name prompt → `POST /api/geofences`
- [x] Edit polygon vertices → `PUT /api/geofences/:name`
- [x] Rename polygon via toolbar button
- [x] Delete polygon via toolbar button
- [x] Live tracker markers (same WS feed)
- [x] Changes immediately visible in public UI

## Documentation
- [x] `README.md` with setup, env vars, Traccar configuration
- [x] `tasks.md` (this file)
