# Raleigh Bikeways

Static Mapbox map with BRouter bicycle routing. Serve this directory over HTTP
(for example, `python3 -m http.server 8765`).

## Closure avoidance

“Avoid mapped Raleigh closures” is enabled by default. Every route request loads
current `CLOSED_TEMP` and `CLOSED_STORM` segments from Raleigh's
`Greenway_Trails_All/FeatureServer/0` ArcGIS service. `ALERT` and
`PERIODIC_CLOSURE` remain passable. Storm closures also appear in the red map layer.

`closure-routing.js` buffers closed lines by 25 meters with Turf, unions adjacent
segments, simplifies the resulting polygons, and sends their outer rings through
BRouter's `polygons` query parameter. This accommodates small GIS/OpenStreetMap
alignment differences. It can also exclude nearby roads and grade-separated
crossings, so detours may be conservative. These are two-dimensional exclusions.

Endpoints inside an exclusion are rejected. The returned route is checked against
the same polygons, including snapped endpoints; intersecting routes are not shown.
If fetching closure data or routing fails, the UI explains the failure and does
not silently fall back to a route through closures. Users can explicitly turn
avoidance off. Changing endpoints or the checkbox cancels the previous request.

This only covers closures present in Raleigh's GIS. Website-only notices, other
municipalities, and unreported closures are not included. A long-lived map can
show older GIS styling than a newly requested route, which fetches fresh data.

The public BRouter server was verified with GET polygon exclusions. Routing POST
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
try an endpoint inside a closure, and change/clear the route while loading.
Check that failures never leave a previous route visible as a new result.
