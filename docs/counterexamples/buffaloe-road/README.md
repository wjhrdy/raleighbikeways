# Buffaloe Road crossing regression

Recreated September 24, 2026, from the [reviewer's screenshot](https://github.com/oaksandspokes/raleighbikeways/pull/65#issuecomment-5816124088).
The screenshot shows endpoints on opposite sides of the Neuse River at Buffaloe
Road. These coordinates approximate those pins; the exact original coordinates
were not provided.

- Start: longitude **-78.5318**, latitude **35.8488**
- Destination: longitude **-78.5291**, latitude **35.8484**
- Profile: this PR's `brouter-profiles/standard.brf`, uploaded to public BRouter
- Closure source: current Raleigh GIS, saved in `closures.geojson`

| Behavior | Distance | Estimated time | Touches closure buffer |
| --- | ---: | ---: | --- |
| Before: impassable polygons | 17,463 m | 3,313 s | No |
| After: polygon weight 10 | 501 m | 78 s | Yes |

The updated route crosses at Buffaloe Road instead of taking the long detour.
Its BRouter way tags contain residential access and primary road segments,
with no cycleway segments. The UI must display the closure-area access warning:
two-dimensional closure geometry overlaps the road crossing, and the routing
result does not independently establish whether access is open.

The saved `before.geojson` and `after.geojson` contain actual returned route
geometry with distance/time/cost metadata. They use the same input endpoints,
profile, and closure snapshot.

To repeat with the saved snapshot, use `createAvoidance` from
`closure-routing.js` on `closures.geojson`. Upload the profile using the app's
existing profile upload flow. Request the route with `routeUrl` using the
coordinates above. For the old behavior, remove the final comma-separated
weight from each pipe-separated polygon before requesting the comparison.
The updated route should cross locally and remain under 1 km; the impassable
version should take the long detour. Live results can change as OSM or BRouter
changes. Repeat with freshly loaded GIS data to check current closure behavior.

The existing automated tests separately verify finite polygon weights,
acceptance of crossings, and the visible access warning.
