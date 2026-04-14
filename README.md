# CTF - Capture The Flag

Realtime Capture The Flag-platform met Traccar GPS-trackers, polygon-geofences, live score, rondes, history en Web Push notificaties.

## Wat deze app doet

Teams claimen gebieden op basis van echte GPS-posities.
Een claim slaagt wanneer een tracker lang genoeg aaneengesloten binnen een gebied blijft.

Belangrijkste regels:

1. Capture-logica draait alleen als de game status `running` is.
2. Bij status `paused` of `stopped` lopen claim-klokken niet door; timers zijn server-gefrozen.
3. Bij status `stopped` wordt de actieve ronde opgeslagen in history.

## Hoofdonderdelen

1. Publieke livekaart op `/` en `/pub`.
2. Adminomgeving op `/admin` (Basic Auth).
3. Traccar webhook endpoint op `/traccar`.
4. Realtime updates via WebSocket op `/ws`.
5. Persistente opslag in SQLite (`/data/app.db`).

## Leeswijzer

Deze README is opgesplitst in 3 praktische delen:

1. Snelle start (2 minuten): direct draaien met Docker Compose.
2. Admin handleiding: dagelijkse bediening en spelbeheer.
3. API reference (technisch): endpoints, websocket events en snapshotvelden.

## Admin handleiding

### Workflow in 6 stappen

1. Open `/admin` en log in met Basic Auth.
2. Teken/importeer geofences en stel teams + device mapping in.
3. Kies game mode (`wait` of `credits`) en zet capture hold-time.
4. Start ronde via status `running`.
5. Pauzeer (`paused`) of stop (`stopped`) indien nodig.
6. Bekijk history en scores na afloop.

### Functionaliteit

### Publieke pagina (`/` en `/pub`)

1. Live kaart met alle geofences en trackerposities.
2. Score-pills per team.
3. Geofence owner-overzicht op basis van live snapshot.
4. Claim-klok per geofence (alleen bij owner != `Neutral`).
5. Claim-klok bevriest correct bij `paused` en `stopped`.
6. Opstartflow: team kiezen, daarna push activeren.
7. Team-lock tijdens `running`: team wisselen is dan geblokkeerd.
8. Credits-pill voor geselecteerd team in `credits` mode.
9. Team-alerts bij bijvoorbeeld blocked captures.
10. iOS PWA fallback notificaties als PushManager niet beschikbaar is.
11. Responsive layout voor mobiel en tablet.

### Admin pagina (`/admin`)

1. Geofences tekenen, aanpassen, hernoemen en verwijderen.
2. Geofences importeren/exporteren (`replace` of `merge`).
3. Live trackerweergave en centrale claim-klokken op kaart.
4. Game controls: `running`, `paused`, `stopped`, `reset`.
5. Capture hold-time configureren (alleen bij paused/stopped).
6. Initial team credits configureren (alleen bij paused/stopped).
7. Game mode kiezen (`wait` of `credits`, alleen bij paused/stopped).
8. Teambeheer: teamnamen, kleuren, device->team mapping.
9. Push panel: subscriber stats en admin broadcast.
10. Scores panel met owners en occupancy statistieken.
11. History panel met afgeronde rondes en geofence snapshot per ronde.
12. Responsive beheerinterface.

### Game modes

1. `wait`
- Claimen kost geen credits.
- Alleen capture hold-time bepaalt of claim slaagt.

2. `credits`
- Claimen kost credits op basis van geofence-oppervlak.
- Kostenformule: `ceil(area_m2)` credits.
- Claim met onvoldoende credits wordt geblokkeerd (`capture_blocked`).

## Game state en rondegedrag

1. `stopped -> running`
- Start nieuwe ronde.
- Reset scores en owners.
- Initialiseert credits in `credits` mode.
- Weigert start als game mode niet gezet is.

2. `running -> paused`
- Capture-checks stoppen.
- Claim-klokken worden bevroren op server-tijd.

3. `paused -> running`
- Capture-checks hervatten.
- Geofence-enter timers schuiven mee zodat pauzetijd niet meetelt.

4. `running/paused -> stopped`
- Actieve ronde wordt opgeslagen in history.
- Snapshot bevat eindscores, eindcredits, owners en geofences.

5. `reset`
- Reset game progress en in-memory capture state.

## Push notificaties

1. VAPID wordt ondersteund via env vars.
2. Zonder VAPID env vars worden keys automatisch gegenereerd en in DB opgeslagen.
3. Team-specifieke subscriptions worden opgeslagen in SQLite.
4. Notificaties bij:
- succesvolle claim (`capture`)
- onvoldoende credits (`capture_blocked`, alleen betrokken team)
- game status wijziging (`running`, `paused`, `stopped`)
- admin broadcast

## API reference (technisch)

### Publieke API

1. `GET /healthz`
2. `GET /api/state`
3. `GET /api/game`
4. `GET /api/geofences`
5. `POST /traccar`
6. `GET /api/push/public-key`
7. `POST /api/push/subscribe`
8. `POST /api/push/unsubscribe`

### Admin API (Basic Auth)

1. `GET /api/admin/teams`
2. `PUT /api/admin/teams`
3. `GET /api/admin/scores`
4. `GET /api/admin/history`
5. `GET /api/admin/history/:id`
6. `GET /api/admin/geofences/export`
7. `POST /api/admin/geofences/import`
8. `GET /api/admin/settings`
9. `PUT /api/admin/settings`
10. `GET /api/admin/push/stats`
11. `POST /api/admin/push/broadcast`
12. `PUT /api/game/status`
13. `POST /api/game/reset`
14. `POST /api/geofences`
15. `PUT /api/geofences/:name`
16. `DELETE /api/geofences/:name`

Opmerking:
Admin API gebruikt Basic Auth. Extra origin/referer checks kunnen optioneel aangezet worden via `STRICT_ADMIN_ORIGIN_CHECK=1`.

## WebSocket eventtypes

Server kan onder andere deze events sturen:

1. `snapshot`
2. `position`
3. `geofence_update`
4. `geofence_delete`
5. `capture`
6. `capture_blocked`
7. `settings_update`
8. `admin_broadcast`

## Snapshot velden (belangrijk)

`/api/state` en init-snapshot op `/ws` bevatten o.a.:

1. `geofences`, `positions`, `scores`, `owners`
2. `teamCredits`
3. `occupancyMs`, `occupancyByTerritory`
4. `mapDefault`
5. `teams`, `teamColors`
6. `game.status`, `game.mode`, `game.captureHoldMs`, `game.initialTeamCredits`
7. `game.claimClockFreezeAt`

## Omgevingsvariabelen

| Variabele | Standaard | Betekenis |
|---|---|---|
| `PORT` | `3456` | HTTP-poort |
| `DB_PATH` | `/data/app.db` | Pad naar SQLite database |
| `ADMIN_USER` | `admin` | Admin gebruikersnaam |
| `ADMIN_PASS` | `admin` | Admin wachtwoord |
| `VAPID_PUBLIC_KEY` | leeg | Web Push public key |
| `VAPID_PRIVATE_KEY` | leeg | Web Push private key |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Contactsubject voor push |
| `STRICT_ADMIN_ORIGIN_CHECK` | leeg (`0` gedrag) | Zet op `1` om strikte origin/referer check te forceren |
| `ADMIN_PUBLIC_HOSTS` | leeg | Toegestane hosts voor strict admin-origin check |

## Snelle start (2 minuten)

### 1. Repo clonen

```bash
git clone https://github.com/DhrSoulslayer/CTF.git
cd CTF
```

### 2. Starten

```bash
docker compose pull
docker compose up -d
```

Standaard luistert de app op `http://localhost:3456`.

### 2b. Directe checks

1. Publieke kaart: `/` of `/pub`
2. Admin: `/admin`
3. Healthcheck: `/healthz`

### 3. Volumes

`docker-compose.yml` gebruikt volume `ctf-data` voor persistente opslag van DB en instellingen.

## Docker image build en push

Deze repository is ingesteld op Docker Hub image `dhrsoulslayer/ctf:latest`.

Handmatige build/push:

```bash
docker build -t dhrsoulslayer/ctf:latest .
docker push dhrsoulslayer/ctf:latest
```

Daarna op doelhost:

```bash
docker compose pull
docker compose up -d
```

## Traccar configuratie

Gebruik Traccar position forwarder in JSON-formaat:

```xml
<entry key='forward.type'>json</entry>
<entry key='forward.url'>http://JOUW_HOST:3456/traccar</entry>
```

Optioneel retries:

```xml
<entry key='forward.retry.enable'>true</entry>
```

Belangrijk:

1. `uniqueId` van Traccar-device moet overeenkomen met je device mapping.
2. Teamkoppeling staat in `src/shared/teams.json` of wordt in admin ingesteld.
3. Traccar moet endpoint `/traccar` netwerkmatig kunnen bereiken.

## Voorbeeld payload voor `/traccar`

```json
{
  "device": {
    "uniqueId": "15839851",
    "name": "Tracker Alfa",
    "lastUpdate": "2026-04-08T18:30:00.000Z"
  },
  "position": {
    "latitude": 52.0,
    "longitude": 5.0,
    "serverTime": "2026-04-08T18:30:00.000Z"
  }
}
```

## Dataopslag

SQLite bewaart onder andere:

1. Geofences met owner en ownerSince.
2. Laatste positie per device.
3. Teamscores.
4. Team credits.
5. Occupancy totalen per team.
6. Occupancy per geofence per team.
7. Rondehistory met geofence snapshot.
8. Push subscriptions per team.
9. VAPID configuratie (indien auto-gegenereerd).

## Projectstructuur

```text
.
|- docker-compose.yml
|- Dockerfile
|- package.json
|- README.md
|- src/
|  |- server/
|  |  |- db.js
|  |  |- gameLogic.js
|  |  |- index.js
|  |  |- push.js
|  |- shared/
|  |  |- teams.json
|  |- web/
|     |- admin/
|     |  |- index.html
|     |- lib/
|     |- pub/
|        |- index.html
|        |- manifest.webmanifest
|        |- sw.js
```
