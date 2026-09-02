# Proposal: 10 activity types for the OSPD Geoprocessing Activities register

**Prepared for the OSPD 2026 review of** <https://catalog.ospd.dev.kurrawong.ai/>
**Context:** the D100 Workflow Profiler emits provenance records for a live
production workflow (RAG over USDA FAS data) that would benefit from
resolving its `prov:type` URIs against the OSPD register. This document
enumerates every activity type the workflow emits, in the form of a
proposal to add them to a register alongside the existing demo entries
(`demo:ogc-geoacs`, `demo:cro-geoacs`, `demo:euro-geoacs`).

## Register survey (as of 2026-09-01)

Three demo registers under `demo:geoacs`, 10 distinct items:

| Register | Items |
|---|---|
| `demo:ogc-geoacs` (6) | buffer, cloud-removal, dissolve, waterbody-detection, dissolve-grasslands, ice-detection |
| `demo:cro-geoacs` (3) | dissolve-grasslands, rapid-river-detection, slow-river-detection |
| `demo:euro-geoacs` (3) | ice-detection, lake-detection, river-detection |

All 10 are pixel- and geometry-level ops on rasters/vectors — a
geospatial-analysis vocabulary. **Zero of the 10 map onto our 10
activity types** (below), so the proposal is genuinely additive.

## Live production emission counts

Facet on `prov_activityType` in Solr `main` (Voyager HQ 3.x demo, single
19,262-document FAS PSD Online corpus, plus a small backfill of prior
FAS Briefs runs — 1,396,250 total records):

| Records | Current URI (voyager-internal) | Proposed OSPD register URI |
|---:|---|---|
| 407,528 | `https://voyager.ogc/prov/activity/classify-region` | `http://ospd/demo/classify-region` |
| 203,914 | `https://voyager.ogc/prov/activity/nlp-extract-entities` | `http://ospd/demo/nlp-extract-entities` |
| 203,914 | `https://d110.ogc.org/registers/prov-activity/geotag` (placeholder) | `http://ospd/demo/geotag` |
| 203,764 | `https://d110.ogc.org/registers/prov-activity/classify-commodity` (placeholder) | `http://ospd/demo/classify-commodity` |
| 203,764 | `https://voyager.ogc/prov/activity/field-normalize` | `http://ospd/demo/field-normalize` |
| 57,786 | `https://voyager.ogc/prov/activity/fas-source-fetch` | `http://ospd/demo/fas-source-fetch` |
| 57,786 | `https://voyager.ogc/prov/activity/fas-code-decode` | `http://ospd/demo/fas-code-decode` |
| 57,786 | `https://voyager.ogc/prov/activity/fas-geolocate` | `http://ospd/demo/fas-geolocate` |
| 2 | `https://voyager.ogc/prov/activity/retrieve` | `http://ospd/demo/retrieve` |
| 1 | `https://voyager.ogc/prov/activity/generate` | `http://ospd/demo/generate` |

The two `d110.ogc.org/registers/...` URIs are our internal placeholders
from an earlier planning cycle; the intent has always been to remap
onto the settled OSPD register — this proposal is that remap.

## Proposed items — text-metadata / RAG enrichment vocabulary

Every entry below could carry the same shape the demo already uses
(`rdf:type ospd:GeoprocessingActivity`), extended with lifecycle
governance via the Registry Catalogue Model.

### Connector-side (C-chain — 3 types)

- **`fas-source-fetch`** — External catalog API pull. Agent is a Voyager
  HQ Python connector; used-entity is an external endpoint URL, generated-
  entity is a raw source record. Instances: 57,786.

- **`fas-code-decode`** — Numeric-code → human-readable-string lookup
  against a compiled taxonomy. Turns FAS unit IDs, attribute IDs, and
  ISO country codes into descriptive fields. Instances: 57,786.

- **`fas-geolocate`** — Country/place-name → GeoJSON geometry lookup via
  a gazetteer service. Terminal step of the connector chain; generates
  the `indexed-doc` entity that bridges to the pipeline chain.
  Instances: 57,786.

### Pipeline-side (P-chain — 5 types)

- **`nlp-extract-entities`** — Named-entity recognition over document
  text. Emits structured entity mentions (persons, organizations,
  places, events, products). Semantically the *upstream* of `geotag`.
  Instances: 203,914.

- **`geotag`** — Place-name mention → coordinate lookup. Consumes the
  place mentions produced by NLP extraction, resolves each against an
  external gazetteer. **Overlaps semantically with `waterbody-detection`
  et al. in that it produces spatial features**, but differs in input
  modality — text-derived vs pixel-derived. Instances: 203,914.

- **`classify-commodity`** — Text → commodity-taxonomy classifier
  (dictionary matcher over normalized labels). Domain-specific. Instances:
  203,764.

- **`classify-region`** — Text → region-taxonomy classifier. Emitted
  twice in the pipeline (once for canonical region classification, once
  for cross-repo tagging), which is why its total is 2× the others.
  Instances: 407,528 (= 203,764 × 2).

- **`field-normalize`** — Field concatenation / normalization to a
  common schema across heterogeneous inputs. Instances: 203,764.

### RAG-side (Layer 2 — 2 types)

- **`retrieve`** — Hybrid Solr search over the enriched index (semantic +
  lexical). Emitted by the mastra `voyager-search` tool. Instances: 2
  (small — only a handful of `/ask?prov=true` demo calls so far).

- **`generate`** — LLM answer synthesis over retrieved chunks (currently
  `claude-haiku-4-5-20251001`). Instances: 1.

## Why this belongs in the OSPD register

The email introducing the demo registers explicitly notes *"multiple
registers of Geoprocessing Activities. Not federated yet, but could
be!"* — suggesting the register model is **modular by topic**. This
proposal is naturally a **fourth register**, e.g. `demo:enrichment-geoacs`
or `demo:catalog-geoacs`, that carries these text-metadata / RAG
enrichment activities alongside the existing geospatial-analysis
registers.

Two concrete reasons this contribution is worth adopting:

1. **It's grounded in a live D100 workflow.** Every URI here has real
   emission counts against it, right now, in a running system. That's
   the strongest possible evidence that an activity type is worth
   registering — as opposed to being nominated in the abstract.

2. **It gives OSPD a non-toy Provenance Profile Building Block
   consumer.** The current demo activities are used illustratively;
   these activities are used by a workflow with actual provenance-
   traceable outputs (LLM answers with a 538-activity PROV DAG per
   question). That's the "downstream consumer" story that motivates the
   register's existence.

## Open questions for Nick and the group

1. **Register scope.** Is the intended scope of the register
   *any* activity that a D100-style workflow emits, or is it narrower
   (geospatial-analysis only)? The plural language in the intro email
   suggests the former, but confirming would let us stop debating the
   fit of each proposal.

2. **Governance workflow.** How does an item get from "proposed" to
   "accepted"? Assuming the Governance profile carries lifecycle status
   (`proposed` → `stable` → `deprecated`), that's the mechanism we'd
   like to feed our 10 candidates into.

3. **URI shape.** The current items use `http://ospd/demo/{slug}` — is
   that stable, or will they be re-based (e.g. onto a `www.opengis.net`
   host) before the register hardens? Our register-remap file needs a
   final target we can commit to.

4. **Federation.** Once federation is turned on, would our proposed
   entries be reachable through the OGC register's federated view, or
   would they live in a separate register that consumers of the OGC
   register discover through a link? Either works for us — the
   difference matters mainly for LD-client crawl behavior.

## What we'll do next either way

- Repoint our internal remap file
  ([`voyager-prov-ts/src/hq-runjs/prov-emit.js`](../src/hq-runjs/prov-emit.js)
  and its runtime file `/hq/home/py/test_data/prov-register-map.json`)
  at the settled URIs as soon as they're announced.
- Contribute a real dataset dump of ~1.4M PROV records (JSON-LD) so
  Nick's team can exercise the LD client against a non-toy graph.
- Bring the same three questions above to the next OSPD meeting.
