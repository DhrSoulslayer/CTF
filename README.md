# CTF - Capture The Flag

Realtime Capture The Flag-platform met Traccar GPS-trackers.

Een team verovert een gebied wanneer een tracker minimaal 30 seconden aaneengesloten binnen dat gebied blijft.

## Overzicht

Deze applicatie bestaat uit:

1. Publieke livekaart op /pub voor spelers en toeschouwers.
2. Beveiligde adminomgeving op /admin voor kaart- en gamebeheer.
3. Traccar webhook op /traccar voor inkomende GPS-posities.
4. Realtime synchronisatie via WebSocket (/ws).
5. Persistente opslag in SQLite (/data/app.db).

## Functionaliteit

### Publieke pagina (/pub)

1. Live kaart met alle gebieden en trackerposities.
2. Scorebord met teamscores.
3. Overzicht van gebiedseigenaren.
4. Home-knop om de kaart op alle gebieden te centreren.
5. Admin-knop die doorverwijst naar /admin/.

### Admin pagina (/admin)

Basic Auth-beveiligde beheerpagina met drie panelen.

1. Kaart bewerken:
   - Polygonen tekenen.
   - Bestaande polygonen aanpassen.
   - Gebieden hernoemen of verwijderen.
   - Live trackerweergave op de kaart.
   - Gamebediening: Start, Pause, Stop, Reset.
2. Scores:
   - Teamscore per team.
   - Huidige eigenaar per gebied.
   - Bezettingstijd per team.
   - Bezettingstijd per gebied per team (matrixweergave).
3. Teams:
   - Teamnamen en kleuren beheren.
   - Tracker uniqueId -> team mapping beheren.
   - Wijzigingen direct live toepassen na opslaan.

### Captureregels

1. Positie komt binnen via Traccar.
2. Alleen bij game status running wordt capturelogica toegepast.
3. Als een tracker 30 seconden aaneengesloten in een gebied blijft, wordt het gebied overgenomen.
4. Score telt alleen op bij echte wisseling van eigenaar.
5. Bij eigenaarswissel wordt bezettingstijd van de vorige eigenaar opgeslagen.

### Opslag en historie

De database bewaart onder andere:

1. Geofences, eigenaar en eigenaar-sinds-tijdstip.
2. Laatste positie per tracker.
3. Teamscores.
4. Gamestatus.
5. Totale bezettingstijd per team.
6. Bezettingstijd per gebied per team.

## Snel starten (Docker Compose)

### 1. Repository ophalen

```bash
git clone https://github.com/DhrSoulslayer/CTF.git
cd CTF
```

### 2. Teams en tracker-mapping instellen

Pas src/shared/teams.json aan. Koppel Traccar uniqueId's aan teamnamen.

Voorbeeld:

```json
{
  "teams": [
    { "name": "Alfa", "color": "#e6194B" },
    { "name": "Bravo", "color": "#3cb44b" }
  ],
  "devices": {
    "15839851": "Alfa",
    "12345678": "Bravo"
  }
}
```

### 3. Applicatie starten

```bash
docker compose up -d --build
```

Standaard draait de app op poort 3000.

### 4. Traccar webhook instellen

Voeg in Traccar toe:

```text
http://JOUW_HOST:3000/traccar
```

## Lokaal draaien zonder Docker

```bash
npm install
npm start
```

Let op: standaard wordt DB_PATH gebruikt zoals in de code geconfigureerd. Met Docker staat deze op /data/app.db.

## URL's

| URL | Doel |
|---|---|
| / | Redirect naar /pub |
| /pub | Publieke livekaart |
| /admin | Adminomgeving (Basic Auth) |
| /healthz | Healthcheck |
| /api/state | Volledige snapshot (JSON) |
| /ws | WebSocket realtime updates |

## Omgevingsvariabelen

| Variabele | Standaard | Betekenis |
|---|---|---|
| PORT | 3000 | HTTP-poort |
| DB_PATH | /data/app.db | Pad naar SQLite database |
| ADMIN_USER | admin | Gebruikersnaam voor /admin |
| ADMIN_PASS | admin | Wachtwoord voor /admin |

Opmerking: in docker-compose.yml staan momenteel project-specifieke waarden ingesteld voor ADMIN_PASS.

## API-overzicht

### Publiek

1. GET /healthz
2. GET /api/state
3. GET /api/game
4. GET /api/geofences
5. POST /traccar

### Admin-beveiligd (Basic Auth + adminpagina referercontrole)

1. GET /api/admin/teams
2. PUT /api/admin/teams
3. GET /api/admin/scores
4. PUT /api/game/status
5. POST /api/game/reset
6. POST /api/geofences
7. PUT /api/geofences/:name
8. DELETE /api/geofences/:name

## WebSocket-events

Server stuurt onder andere deze eventtypes:

1. snapshot
2. position
3. geofence_update
4. geofence_delete
5. capture
6. game_status

## Teams en standaardkleuren

| Team | Kleur |
|---|---|
| Alfa | #e6194B |
| Bravo | #3cb44b |
| Charlie | #ffe119 |
| Delta | #4363d8 |
| Echo | #f58231 |
| Foxtrot | #911eb4 |
| Juliet | #46f0f0 |
| India | #fabed4 |
| Neutral | #808080 |

## Projectstructuur

```text
.
|- Dockerfile
|- docker-compose.yml
|- package.json
|- README.md
|- src/
|  |- server/
|  |  |- index.js
|  |  |- db.js
|  |  |- gameLogic.js
|  |- shared/
|  |  |- teams.json
|  |- web/
|     |- pub/
|     |  |- index.html
|     |- admin/
|        |- index.html
```

## Technische notities

1. Bij connectie op /ws ontvangt elke client eerst een volledige snapshot.
2. SQLite draait in WAL-modus voor betere leesprestaties.
3. Score- en bezettingstijden blijven behouden over restarts (bij persistent volume).
4. Reset wist posities, scores en bezettingstijdhistorie en zet alle gebieden terug naar Neutral.
