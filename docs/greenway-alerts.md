# Nightly Greenways alert import

The `Refresh greenway alerts` GitHub Actions workflow fetches Raleigh's published
Greenways notices every night at **08:17 UTC** (03:17 EST / 04:17 EDT). It can also
be run manually from Actions using **Run workflow**. This branch is independent
of the GIS closure-routing feature.

## Source and snapshot

The importer uses `https://raleighnc.gov/jsonapi/node/status_alert` with:

- `filter[field_alert_category.drupal_internal__tid]=746` (Greenways)
- `filter[status]=1` (published; otherwise unpublished records can obscure results)
- `include=field_alert_type,field_place_affected,field_project_affected`
- `page[limit]=50`, following pagination until complete

`data/greenway-alerts.json` contains a versioned snapshot, source page URL, UTC
`fetchedAt`, and notices with stable IDs, canonical URLs, red/yellow/green codes,
plain-text descriptions, affected dates, source modification times, linked maps,
and affected places/projects. The initial import returned four notices.

Descriptions are plain text, not executable HTML. Consumers should use
`textContent` and check `fetchedAt` for freshness. The import preserves published
notices and upstream wording; it does not infer current closure state from color
or dates. For example, a Code Red notice can describe an upcoming closure.
Website alerts do not provide closure-segment geometry and are not automatically
converted into routing exclusions. This change supplies data; it does not add an
alert display to the map.

## Running locally

Requires Python 3.10+ and curl (both available on GitHub's Ubuntu runners). No
pip packages, API credentials, or third-party Actions beyond checkout/setup-python
are needed. curl is used because the city returned HTTP 403 to Python's urllib
client during testing while accepting curl requests.

```sh
python3 -m unittest discover -s tests -p 'test_greenway_alerts.py' -v
python3 scripts/fetch_greenway_alerts.py
# Optional: write elsewhere for a dry run
python3 scripts/fetch_greenway_alerts.py --output /tmp/greenway-alerts.json
```

The importer retries transient network errors, validates all pages and required
relationships, and atomically replaces the snapshot only after success. Failed
or partial responses leave the last good file untouched and fail the Action.
A valid empty response removes old notices. Each successful refresh updates
`fetchedAt`, so there is a daily freshness commit even when notices are unchanged.

## Activating the schedule

Merge the workflow onto the repository's default branch to activate nightly runs.
GitHub schedules run from the default branch and can be delayed. Schedules in
public repositories may be disabled after 60 days without repository activity;
check the Actions page if refreshes stop. Forks may require enabling Actions.
Manual dispatch uses the selected branch, including for testing after the workflow
has become available on the default branch.

The refresh job requests `contents: write` using the built-in `GITHUB_TOKEN` and
commits only the snapshot as `github-actions[bot]`. Pull-request checks only run
the offline tests with read access. Repository policies/branch protection must
permit the bot's normal push; this workflow does not bypass those rules or force
push. Concurrent edits are rebased before pushing, and a conflict fails the run.

Data becomes available on the hosted site through the site's usual deployment
process. Commits made with `GITHUB_TOKEN` do not trigger other push-based GitHub
Actions workflows; a future Actions-based deploy must be explicitly chained if
it needs to publish each nightly snapshot. No deployment is added here.
