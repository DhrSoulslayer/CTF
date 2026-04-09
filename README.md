# CTF - Capture The Flag

Realtime Capture The Flag-platform met Traccar GPS-trackers.

Een team verovert een gebied wanneer een tracker minimaal 30 seconden aaneengesloten binnen dat gebied blijft.

## Overzicht

Deze applicatie bestaat uit:

1. Publieke livekaart op /pub voor spelers en toeschouwers.
2. Beveiligde adminomgeving op /admin voor kaart- en gamebeheer.
3. Traccar position forward endpoint op /traccar voor inkomende GPS-posities.
4. Realtime synchronisatie via WebSocket (/ws).
5. Persistente opslag in SQLite (/data/app.db).

## Functionaliteit

### Publieke pagina (/pub)

1. Live kaart met alle gebieden en trackerposities.
2. Scorebord met teamscores.
3. Overzicht van gebiedseigenaren.
4. Home-knop om de kaart op alle gebieden te centreren.
5. Admin-knop die doorverwijst naar /admin/.
6. Centrale claim-klok per gebied: toont alleen de huidige claimduur sinds de laatste owner-wissel en kleurt mee met de eigenaar.
7. Voor gebieden met owner `Neutral` wordt geen claim-klok getoond.
7. Responsive layout voor mobiel en tablet.
8. Opstartflow: eerst team kiezen, daarna optioneel push inschakelen, daarna live kaart laden.
9. Team wisselen tijdens running is geblokkeerd; wisselen kan alleen bij paused of stopped.
10. Geselecteerd team ziet live eigen resterende credits op de publieke pagina.

### Admin pagina (/admin)

Basic Auth-beveiligde beheerpagina met vijf panelen.

1. Kaart bewerken:
   - Polygonen tekenen.
  - Oppervlakte per gebied zichtbaar in m² tijdens beheer.
   - Bestaande polygonen aanpassen.
   - Gebieden hernoemen of verwijderen.
   - Live trackerweergave op de kaart.
  - Centrale claim-klok per gebied die live oploopt en reset bij eigenaarswissel.
  - Instelbare claimtijd (in seconden) voor gebiedsovername.
  - Claimtijd wijzigen is alleen toegestaan bij game status paused of stopped.
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
4. Responsive bediening op mobiel/tablet, inclusief bruikbare tracker-ID en teaminvoervelden.
5. History:
  - Overzicht van opgeslagen rondes.
  - Per ronde eindscore en eindtijd.
  - Kaartweergave van polygonen zoals gebruikt in die ronde (snapshot), ook als latere polygonen zijn aangepast of opnieuw geïmporteerd.
6. Spelmodi:
  - Precies 1 actieve modus tegelijk: `wait` of `credits`.
  - `wait`: claimen kost geen credits, alleen wachttijd.
  - `credits`: claimen kost credits op basis van oppervlakte.
  - Modus moet gekozen zijn voordat een ronde gestart kan worden.
  - Modus is alleen wijzigbaar als de game status `stopped` is.

### PWA en pushmeldingen

1. De app bevat een Web App Manifest op `/manifest.webmanifest`.
2. Service worker staat op `/sw.js` en wordt geregistreerd in `/pub` en `/admin`.
3. Push events worden in de service worker afgehandeld en als notificatie getoond.
4. Voor push en install als PWA is HTTPS nodig (of localhost tijdens development).
5. Jij regelt SSL en reverse proxy; dat is voldoende om Web Push browser-vereisten te halen.
6. De server heeft VAPID-configuratie nodig om push te versturen.
7. Push-subscriptions worden team-specifiek opgeslagen; meldingen over gebiedsverlies gaan alleen naar het geselecteerde team.

VAPID environment variabelen:

1. `VAPID_PUBLIC_KEY`
2. `VAPID_PRIVATE_KEY`
3. `VAPID_SUBJECT` (bijvoorbeeld `mailto:admin@jouwdomein.nl`)

Zonder deze variabelen blijft push uitgeschakeld op de server.

### Captureregels

1. Positie komt binnen via Traccar.
2. Alleen bij game status running wordt capturelogica toegepast.
4. Als een tracker minimaal de ingestelde capture-tijd aaneengesloten in een gebied blijft, wordt het gebied overgenomen.
4. Claimen kost credits op basis van gebiedsgrootte: 1 credit per m² (afgerond naar boven).
5. Een claim wordt alleen uitgevoerd als het team voldoende credits heeft.
6. Score telt alleen op bij echte wisseling van eigenaar.
5. Bij eigenaarswissel wordt bezettingstijd van de vorige eigenaar opgeslagen.
6. Neutral-bezettingstijd wordt niet bijgehouden.
7. Bij eigenaarswissel ontvangt een push-geabonneerde browser een melding dat een team een gebied kwijt is geraakt.
8. Bij onvoldoende credits voor een claimpoging ontvangt het betrokken team een pushmelding.

Game status-overgangen:

1. Overgang van stopped naar running start een nieuwe ronde, zet scores op nul en geeft elk team dezelfde startcredits.
2. Tijdens paused blijven scores en credits behouden.
3. Overgang van running of paused naar stopped slaat de ronde op in history.

Capture-tijd configuratie:

1. De capture-tijd is backend-configuratie in milliseconden (standaard 30000 ms).
2. Aanpassen mag alleen als de game status paused of stopped is.
3. Tijdens running wordt een wijziging geweigerd.

Credits configuratie:

1. Startcredits per team zijn backend-configuratie (gelijke waarde voor alle teams per nieuwe ronde).
2. Aanpassen mag alleen als de game status paused of stopped is.
3. Tijdens running wordt een wijziging geweigerd.

### Opslag en historie

De database bewaart onder andere:

1. Geofences, eigenaar en eigenaar-sinds-tijdstip.
2. Laatste positie per tracker.
3. Teamscores.
4. Gamestatus.
5. Totale bezettingstijd per team.
6. Bezettingstijd per gebied per team.
7. Rondehistorie met start/eindtijd, eindscores, eindcredits, owners en polygon-snapshot.

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

Standaard draait de app op poort 3456.

### 4. Traccar configureren

Deze app verwacht aan de Traccar-kant geen gewone event-notification, maar de ingebouwde position forwarder in JSON-formaat.

Stel in Traccar daarom dit in:

```xml
<entry key='forward.type'>json</entry>
<entry key='forward.url'>http://JOUW_HOST:3456/traccar</entry>
```

Optioneel, maar nuttig als je retries wilt bij tijdelijke netwerkfouten:

```xml
<entry key='forward.retry.enable'>true</entry>
```

Belangrijk aan de Traccar-kant:

1. Gebruik `forward.type=json`, anders krijgt deze app niet het payload-formaat dat zij verwacht.
2. `forward.url` mag globaal in de Traccar serverconfig staan of per device als device attribute worden gezet.
3. De Traccar server moet `http://JOUW_HOST:3456/traccar` echt kunnen bereiken. Gebruik dus een hostnaam of IP dat vanuit de Traccar machine/container resolvebaar is.
4. Als deze app achter een reverse proxy draait, gebruik dan de publieke `https://.../traccar` URL.
5. De `uniqueId` van elk device in Traccar moet exact overeenkomen met de device key die je in `src/shared/teams.json` of in de adminpagina aan een team koppelt.
6. De device `name` uit Traccar wordt in deze app gebruikt als trackernaam op de kaart.

De JSON payload die deze app verwacht bevat minimaal:

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

Opmerking: Traccar event notifications zoals geofence enter/exit of alarm notifications zijn voor deze app niet nodig om capturen te laten werken. De capturelogica draait volledig op de doorgestuurde positie-updates.

### 5. Testen zonder Traccar (met curl)

Je kunt de webhook direct testen met curl, zonder Traccar-installatie.

1. Start de app met Docker Compose.
2. Stuur een testpositie naar `/traccar`:

```bash
curl -X POST http://localhost:3456/traccar \
  -H "Content-Type: application/json" \
  -d '{
    "device": {
      "uniqueId": "15839851",
      "name": "Curl Tracker",
      "lastUpdate": "2026-04-08T18:30:00.000Z"
    },
    "position": {
      "latitude": 52.0907,
      "longitude": 5.1214,
      "serverTime": "2026-04-08T18:30:00.000Z"
    }
  }'
```

Verwacht resultaat:

1. HTTP 200 response op de POST-call.
2. De tracker verschijnt op `/pub` en `/admin`.
3. Als `uniqueId` aan een team gekoppeld is, telt de positie mee voor capturelogica.

Snelle capture-test zonder Traccar: stuur dezelfde positie meerdere keren met oplopende tijdstempel (minimaal 30 seconden totaal) terwijl de game op `running` staat en de positie in een gebied ligt.

```bash
for i in $(seq 0 6); do
  ts=$(date -u -d "2026-04-08T18:30:00Z +$((i*5)) seconds" +"%Y-%m-%dT%H:%M:%S.000Z")
  curl -s -X POST http://localhost:3456/traccar \
    -H "Content-Type: application/json" \
    -d "{\"device\":{\"uniqueId\":\"15839851\",\"name\":\"Curl Tracker\",\"lastUpdate\":\"$ts\"},\"position\":{\"latitude\":52.0907,\"longitude\":5.1214,\"serverTime\":\"$ts\"}}" >/dev/null
done
```

Deze applicatie is bedoeld om als Docker-container te draaien. Gebruik daarom Docker Compose of een losse Docker image voor deployments en lokaal gebruik.

### 6. Node-RED flow (proxy op /traccar)

Er staat een importeerbare Node-RED flow in `nodered/traccar-forward-3456.flow.json`.

Wat deze flow doet:

1. Luistert op `POST /traccar` in Node-RED.
2. Stuurt de ontvangen JSON direct door naar `http://localhost:3456/traccar`.
3. Geeft de HTTP-status van de CTF-app terug aan de afzender.

Importeren in Node-RED:

1. Open Node-RED editor.
2. Menu -> Import -> selecteer `nodered/traccar-forward-3456.flow.json`.
3. Klik Deploy.

Opmerking: als Node-RED in Docker draait en niet op dezelfde host-network stack zit, wijzig dan in de flow de target URL naar de service-naam binnen het Docker netwerk (bijvoorbeeld `http://ctf:3456/traccar`).

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
| PORT | 3456 | HTTP-poort |
| DB_PATH | /data/app.db | Pad naar SQLite database |
| ADMIN_USER | admin | Gebruikersnaam voor /admin |
| ADMIN_PASS | admin | Wachtwoord voor /admin |
| VAPID_PUBLIC_KEY | - | Public VAPID key voor Web Push |
| VAPID_PRIVATE_KEY | - | Private VAPID key voor Web Push |
| VAPID_SUBJECT | mailto:admin@example.com | Contactsubject voor Web Push |

Opmerking: in docker-compose.yml staan momenteel project-specifieke waarden ingesteld voor ADMIN_PASS.

## API-overzicht

### Publiek

1. GET /healthz
2. GET /api/state
3. GET /api/game
4. GET /api/geofences
5. POST /traccar
6. GET /api/push/public-key
7. POST /api/push/subscribe
8. POST /api/push/unsubscribe

### Admin-beveiligd (Basic Auth + adminpagina referercontrole)

1. GET /api/admin/teams
2. PUT /api/admin/teams
3. GET /api/admin/scores
4. PUT /api/game/status
5. POST /api/game/reset
6. POST /api/geofences
7. PUT /api/geofences/:name
8. DELETE /api/geofences/:name
9. GET /api/admin/settings
10. PUT /api/admin/settings
11. GET /api/admin/history
12. GET /api/admin/history/:id

## WebSocket-events

Server stuurt onder andere deze eventtypes:

1. snapshot
2. position
3. geofence_update
4. geofence_delete
5. capture
6. game_status
7. settings_update

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
