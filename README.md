# voyager-prov-ts

PROV emission middleware for Voyager workflows — the Node.js half of the
**D100 Workflow Profiler** deliverable for OGC OSPD 2026.

Given a description of one activity in the Voyager RAG pipeline
(ingest → extract → chunk → embed → retrieve → generate), `emit()` returns
two artifacts:

- A **Solr doc** ready to index into the shared `main` collection (matches the
  `prov_*` fields defined in the D100 plan).
- A **PROV-JSON-LD** blob conformant with W3C PROV (subset).

The activity URN is a SHA-256 hash of the identity-defining inputs, so retries
converge on the same id and downstream Solr writes overwrite instead of
duplicating.

`emit()` has no I/O — callers are responsible for writing the Solr doc via
their sink of choice (the `hq_files` workaround in
[voyager-mastra-full-rag/src/ingest/solr-writer.ts](../voyager-mastra-full-rag/src/ingest/solr-writer.ts)
is one such sink).

## Install

```bash
npm install voyager-prov-ts
```

## Usage

```ts
import { emit, entityURI } from "voyager-prov-ts";

const parentId = "AS_2226000_2026_178";

const { solrDoc, jsonld } = emit({
  activityType: "chunk",
  agent: "urn:voyager:agent:mastra-chunker@1.0.0",
  used: [entityURI("extracted-content", parentId)],
  generated: [
    entityURI("chunk", `${parentId}_0`),
    entityURI("chunk", `${parentId}_1`),
  ],
  startedAt: "2026-08-24T12:00:00Z",
  endedAt: "2026-08-24T12:00:01Z",
});

// Write solrDoc via your sink (folder-connector-backed /api/files, direct Solr, …).
// jsonld is the PROV graph representation of the same activity.
```

## D110 register remap

Until D110's process-type register hardens, `emit()` writes
`https://voyager.ogc/prov/activity/<type>` as the `activityType` URI.
At final integration, pass a `remap` table so the Solr doc + JSON-LD carry the
D110 URIs instead:

```ts
import { emit, type RemapTable } from "voyager-prov-ts";

const D110: RemapTable = {
  chunk: "https://d110.ogc.org/registers/prov-activity/chunk",
  embed: "https://d110.ogc.org/registers/prov-activity/embed",
  // …
};

emit(record, { remap: D110 });
```

Missing entries fall back to the Voyager-internal URI, so partial remaps are
safe.

## CLI

```bash
npx voyager-prov emit  < record.json      # print { solrDoc, jsonld }
npx voyager-prov solr  < record.json      # print just the Solr doc
npx voyager-prov jsonld < record.json     # print just the JSON-LD blob
```

## Solr schema

The `main` collection needs these fields to receive `solrDoc`:

| Field | Type | Multi |
|---|---|---|
| `prov_id` | string | no |
| `prov_activityType` | string | no |
| `prov_agent` | string | no |
| `prov_used` | string | yes |
| `prov_generated` | string | yes |
| `prov_startedAt` | tdate | no |
| `prov_endedAt` | tdate | no |
| `prov_jsonld` | string (stored, not indexed) | no |

See [D100 plan Step 3](../../../.claude/plans/fluttering-scribbling-giraffe.md#step-3--solr-schema-additions).

## Testing

```bash
npm run check   # tsc --noEmit
npm test        # 19 unit tests
npm run build   # emit dist/
```

## License

Same as the parent Voyager platform.
