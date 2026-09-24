# Raleigh Bikeways

Static Mapbox map with BRouter bicycle routing. Serve this directory over HTTP
(for example, `python3 -m http.server 8765`).

## Closure avoidance

“Prefer routes away from mapped Raleigh closures” is enabled by default. Every
route request loads
current `CLOSED_TEMP` and `CLOSED_STORM` segments from Raleigh's
`Greenway_Trails_All/FeatureServer/0` ArcGIS service. `ALERT` and
`PERIODIC_CLOSURE` remain passable. Storm closures also appear in the red map layer.

`closure-routing.js` buffers closed lines by 25 meters with Turf, unions adjacent
segments, simplifies the resulting polygons, and sends their outer rings through
BRouter's `polygons` query parameter, with a finite weight of 10 appended to each
ring. This requests a finite cost penalty instead of an impassable wall.

BRouter's polygon penalty can miss route segments wholly inside the polygon.
The app therefore measures the returned route's distance inside the closure
areas. Up to 100 meters total is allowed for short crossings, with an access
warning. Above that limit, it retries once with hard exclusions and rejects
the retry if it still touches a closure. This preserves the original long-trail
detour while allowing the Buffaloe Road street crossing.

These are two-dimensional areas, not trail-specific restrictions. A short
closed-trail section may still be allowed, and a long bridge or several street
crossings totaling over 100 meters may trigger a conservative detour. Riders
must check access whenever the closure-area warning appears.

If fetching closure data or routing fails, the UI explains the failure and does
not silently retry without the closure penalty. Users can explicitly turn the
preference off. Changing endpoints or the checkbox cancels the previous request.

This only covers closures present in Raleigh's GIS. Website-only notices, other
municipalities, and unreported closures are not included. A long-lived map can
show older GIS styling than a newly requested route, which fetches fresh data.

The public BRouter server was verified with GET weighted polygons. Routing POST
bodies were not supported. Requests over 7,500 URL characters are rejected with
an explanatory message, rather than dropping closure polygons. ArcGIS reads are
paginated. As of September 18, 2026, 27 closed segments produce four polygons and
a request of roughly 4.2 KB.

## Development

```sh
npm ci
npm test
npm run build
```

Commit the generated `closure-routing.bundle.js` alongside source changes; the
static site needs no build server. Dependency versions are locked. Third-party
notices are in `THIRD_PARTY_NOTICES.txt`. Bump the cache version in `sw.js` when
shipping changes to cached assets; existing tabs may need to close and reopen
for the new service worker to activate.

Manual verification: choose endpoints near a closure, compare avoidance on/off,
verify the warning for a crossing or endpoint inside a closure, and change/clear
the route while loading.
Check that failures never leave a previous route visible as a new result.
