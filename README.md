# CTF – Capture The Flag

Real-life Capture-The-Flag game using **Traccar GPS trackers** and **polygon geofences**.  
A team captures a territory by keeping a GPS tracker inside it for 30 consecutive seconds.

## Features

- **Public map** (`/pub`) – live Leaflet map with coloured polygon territories, tracker markers, and a scoreboard.
- **Admin map** (`/admin`) – draw / edit / delete / rename polygons on the map. Protected by basic auth.
- **Traccar webhook** (`POST /traccar`) – receives positions from Traccar and updates state in real-time.
- **Real-time** – WebSocket push to all connected clients; full snapshot sent on connect/reconnect.
- **Persistent** – SQLite at `/data/app.db` (Docker volume).

---

## Quick Start

### 1. Clone & configure

```bash
git clone https://github.com/DhrSoulslayer/CTF.git
cd CTF
```

Edit `src/shared/teams.json` to map your Traccar `uniqueId` values to team names:

```json
{
  "devices": {
    "15839851": "Alfa",
    "YOUR_DEVICE_ID": "Bravo"
  }
}
```

### 2. Run with Docker Compose

```bash
# optional – override credentials
export ADMIN_USER=admin
export ADMIN_PASS=secret

docker compose up --build -d
```

The app listens on **port 3000**.

| URL | Description |
|---|---|
| `http://host:3000/` | Redirects to `/pub` |
| `http://host:3000/pub` | Public live map |
| `http://host:3000/admin` | Admin map (requires auth) |
| `http://host:3000/healthz` | Health check |
| `http://host:3000/api/state` | JSON snapshot |

### 3. Configure Traccar

In the Traccar web UI go to **Preferences → Webhooks** and add:

```
http://YOUR_HOST:3000/traccar
```

Traccar will POST JSON in the following format (no changes needed):

```json
{
  "position": { "latitude": 52.15, "longitude": 6.22, "serverTime": "…" },
  "device":   { "name": "Alfa 1", "uniqueId": "15839851", "lastUpdate": "…" }
}
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `/data/app.db` | SQLite database path |
| `ADMIN_USER` | `admin` | Admin basic-auth username |
| `ADMIN_PASS` | `admin` | Admin basic-auth password |

---

## Teams & Colours

| Team | Colour |
|---|---|
| Alfa | `#e6194B` |
| Bravo | `#3cb44b` |
| Charlie | `#ffe119` |
| Delta | `#4363d8` |
| Echo | `#f58231` |
| Foxtrot | `#911eb4` |
| Juliet | `#46f0f0` |
| India | `#fabed4` |
| Neutral | `#808080` |

---

## Project Layout

```
.
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tasks.md
├── src/
│   ├── server/
│   │   ├── index.js      # Express + WebSocket server
│   │   ├── db.js         # SQLite helpers
│   │   └── gameLogic.js  # Capture logic (point-in-polygon, timers)
│   ├── shared/
│   │   └── teams.json    # Device → team mapping
│   └── web/
│       ├── pub/
│       │   └── index.html  # Public UI
│       └── admin/
│           └── index.html  # Admin UI
```

---

## Game Rules

1. A tracker enters a polygon territory.
2. If it stays inside for **≥ 30 seconds** without leaving, the territory is **captured** by the tracker's team.
3. The team's score increases **only when ownership changes** (capturing your own territory again scores nothing).
4. The polygon is immediately recoloured with the capturing team's colour on all connected clients.
