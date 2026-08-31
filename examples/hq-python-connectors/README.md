# HQ Python connectors — live D100 examples

These are working HQ 3.x Python connectors that emit Layer 1 C-chain PROV
records at scan time — the connector-side complement to the runJavaScript
tail emitter in [`../../src/hq-runjs/prov-emit.js`](../../src/hq-runjs/prov-emit.js).

Deploy layout on the HQ pod:
- `psd_online/connector.py` → `/hq/home/py/voyager/connectors/psd_online/connector.py`
- `utils/common.py` → `/hq/home/py/utils/common.py`
- `utils/fas_settings.py` → `/hq/home/py/utils/fas_settings.py`

## `psd_online`

FAS PSD Online commodity data — country × commodity × year × attribute rows
from `api.fas.usda.gov/api/psd`. One scan ≈ 19,262 docs indexed and 57,786
C-chain PROV records emitted (fetch → decode → geolocate). Wall-clock ≈ 3 min.

The connector uses HQ 3.x's placefinder to attach a Natural Earth country
polygon to each doc (`entry['spatial']['shape']`). Auth is a bearer token
minted via `POST /api/tokens` and passed as `Cookie: vg-token=<jwt>`; the
correct placefinder request shape is:

    POST /api/search/placefinder/find?search=<name>
    Cookie: vg-token=<jwt>

The `search` parameter goes on the **query string**, not in the body — a
body-only request always returns the first-loaded gazetteer entry
regardless of input.

## utils

Slim stand-in for the upstream FAS `utils` package:
- `common.py` — only `CommonUtils.query_solr` (the one method PSD Online
  touches). No PDF/OCR/vision imports, so no heavy deps.
- `fas_settings.py` — env-driven config. `PSD_ONLINE_API_KEY` and
  `HQ_API_TOKEN` are compiled-in fallbacks so the deployment works out of
  the box, but the environment always wins.

## Not yet ported

The upstream FAS Drive folder has 14 more connectors (CIR, WAP, GAIN,
Crop Explorer, Photo Gallery, etc.). Same mechanics apply — the
`fas_settings.py` shape has slots for their API keys pre-declared.
