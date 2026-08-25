# FAS Layer 1 — declarative provenance examples

The Voyager RAG pipeline (Layer 2, instrumented at runtime by
[voyager-prov-ts](../../..)) ingests the USDA FAS catalog through a Solr
connector. The FAS catalog itself is a **pre-built** artifact — before we
touched it, FAS ran a chain of geospatial ops (OCR, GeoTagging, Commodity
Classification, Region Classification, NLP entity extraction, Field
Normalization) to assemble it.

For CFP §5.1 alignment we need the D100 profile to describe those Layer 1
ops even though we didn't run them. This directory holds **declarative
PROV assertions** — one JSON-LD file per FAS source type — that record
each upstream op as a `prov:Activity` linked to a `prov:hadPrimarySource`
citing the [Voyager Search Overview for USDA FAS](https://docs.google.com/presentation/d/1IybpPfUqDYji0ge-X0n165gMV8pU2UqlZQFKxIykk5k)
deck (slides 20–29) as evidence.

## Files

- `cir.jsonld` — Commodity Intelligence Reports (NLP, GeoTag, Commodity Classify, OCR, Field Normalize)
- `wap.jsonld` — World Agriculture Production (same op set as CIR)
- `gain.jsonld` — Global Agriculture Information Network (subset — no OCR)
- `production-maps.jsonld` — Production Maps (adds Region Classification)
- `psd-online.jsonld` — PSD Online / Publications (lighter — GeoTag + Commodity + Field Normalize)
- `photo-gallery.jsonld` — Photo Gallery (OCR + GeoTag + Commodity + Field Normalize)
- `crop-calendar.jsonld` — Crop Calendar (GeoTag + Commodity + Field Normalize)
- `gadas-services.jsonld` — GADAS Services (GeoTag + Region Classify via ArcGIS)
- `kcna-cifs.jsonld` — KCNA CIFS Geospatial (GeoTag + Region Classify via folder connector)

## Notes

- Each Activity URI is deterministic per FAS source — Layer 1 assertions
  are stable, not per-doc records. Layer 2 (RAG pipeline) is where per-doc
  provenance lives.
- Agent URIs are `urn:voyager:agent:fas-upstream:<step>` — the
  `fas-upstream` segment marks them as declared, not observed.
- These files validate against the same
  [`prov-jsonld.schema.json`](../../prov-jsonld.schema.json) as runtime
  emissions. Only difference: `startedAtTime`/`endedAtTime` are the
  Voyager deck's citation date, not the actual op time (which is unknown).
