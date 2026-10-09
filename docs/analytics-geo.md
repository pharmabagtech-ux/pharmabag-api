# Analytics: visitor location (country / state / city)

Analytics resolves each visitor's country, Indian state and city from their IP
at ingest, using a **local MaxMind GeoLite2-City database**. Nothing is sent to
a third party and the IP itself is never stored — only the resolved place names,
on `analytics_sessions`.

Until the database file is installed, everything keeps working: sessions are
recorded with null location and every geo report shows them as "Unknown". The
Geography screen surfaces a coverage warning when under 80% of sessions have a
location, so this state is visible rather than silent.

---

## 1. Get a licence key (free, one time)

1. Create a free account at <https://www.maxmind.com/en/geolite2/signup>.
2. In the account portal, **Manage License Keys → Generate new license key**.
3. Keep the key — it is only needed to download and refresh the database, never
   at runtime.

## 2. Download the database onto the API server

```bash
# As the user that runs the API.
sudo mkdir -p /var/lib/geoip
cd /tmp

curl -fsSL -o GeoLite2-City.tar.gz \
  "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=YOUR_LICENSE_KEY&suffix=tar.gz"

tar -xzf GeoLite2-City.tar.gz
sudo mv GeoLite2-City_*/GeoLite2-City.mmdb /var/lib/geoip/GeoLite2-City.mmdb
sudo chmod 644 /var/lib/geoip/GeoLite2-City.mmdb
rm -rf GeoLite2-City.tar.gz GeoLite2-City_*
```

The file is roughly 60–80 MB. It is **not** in source control: it is
licence-restricted and too large to version.

## 3. Point the API at it

```bash
GEOIP_CITY_DB_PATH=/var/lib/geoip/GeoLite2-City.mmdb
```

Restart the API. On the first lookup the log shows:

```
[GeoResolver] GeoLite2 city database loaded from /var/lib/geoip/GeoLite2-City.mmdb
```

If the variable is unset or the file is unreadable, a single warning is logged
and sessions continue to be recorded without location.

## 4. Keep it fresh (monthly)

MaxMind rebuilds GeoLite2 twice a week; a stale file slowly loses accuracy as
address blocks are reassigned. A monthly refresh is plenty.

```cron
# /etc/cron.d/geoip-update — 03:20 on the 2nd of each month
20 3 2 * * root /usr/local/bin/update-geolite2.sh >> /var/log/geoip-update.log 2>&1
```

```bash
#!/usr/bin/env bash
# /usr/local/bin/update-geolite2.sh
set -euo pipefail
KEY="YOUR_LICENSE_KEY"
DEST=/var/lib/geoip/GeoLite2-City.mmdb
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL -o "$TMP/db.tar.gz" \
  "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${KEY}&suffix=tar.gz"
tar -xzf "$TMP/db.tar.gz" -C "$TMP"

# Written to a temp path on the same filesystem then moved, so the swap is
# atomic and a running API never reads a half-written file.
find "$TMP" -name 'GeoLite2-City.mmdb' -exec mv {} "${DEST}.new" \;
chmod 644 "${DEST}.new"
mv "${DEST}.new" "$DEST"

echo "$(date -Is) GeoLite2 updated"
```

The API opens the database once per process, so **restart the API after an
update** for it to be picked up.

---

## How it fits together

```
buyer browser
  └─ POST /api/track            (same-origin proxy, apps/buyer)
       │  reads X-Forwarded-For, takes the left-most PUBLIC address,
       │  attaches it as `ip` (the API only ever sees the proxy otherwise)
       ▼
     POST /analytics/collect    (API)
       │  resolveGeo(ip) → { countryCode, country, region, regionCode, city }
       │  ip discarded, never written
       ▼
     analytics_sessions         (location stored on the session row)
```

Reports read from the session, so location applies to every event in that
session.

### Accuracy, honestly

- **Country**: ~99%.
- **Indian state**: ~90%.
- **Indian city**: roughly 55–80%. Mobile-carrier ranges (a large share of
  Indian traffic) often resolve only to a state, or to the circle's largest
  city. Treat city as a strong signal of relative demand, not a precise count.

Sessions that resolve to a country but not a city appear in the country and
state lists and are absent from the city list — which is why city totals are
lower than state totals. That is expected, not a bug.

### Privacy posture

- The IP is used for the lookup and discarded; it is never persisted.
- Consistent with the existing tracker: random visitor id, no fingerprinting,
  `DNT: 1` disables tracking entirely, and tracking only runs at all when
  `NEXT_PUBLIC_ANALYTICS_ENABLED=true`.
- Because no IP and no precise location is stored, the data stays aggregate.

---

## Reports

| Endpoint | What it answers |
| --- | --- |
| `GET /admin/analytics/geography?from&to` | Countries, Indian states, Indian cities, plus coverage |
| `GET /admin/analytics/products/:productId/geography?from&to&path=` | Where the visitors to one product came from |

`to` is an **exclusive** upper bound (`startedAt < to`), so to include a whole
day pass an end-of-day timestamp. The admin UI does this via
`toApiRange()`; sending a bare `YYYY-MM-DD` for today would exclude today.

The per-product report matches on the event's `productId` **or** the product's
page path, OR'd together. Both are needed: `productId` is precise but only
present on events emitted since product tagging was added, while `page` has
always been recorded and therefore makes historical traffic readable.
