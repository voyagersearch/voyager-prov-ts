/**
 * Emit a PROV record for one activity in the RAG pipeline.
 *
 * Produces two artefacts from the same input: a Solr doc for the shared `main`
 * collection (D100 § Step 3 schema fields) and the corresponding JSON-LD blob
 * (W3C PROV subset). Callers write the Solr doc themselves — this module has
 * no I/O.
 *
 * The activity URN is a SHA-256 hash over the identity-defining inputs so
 * retries and idempotent overwrites converge on the same id. `extra` fields
 * are NOT part of the identity.
 */

import { createHash } from "node:crypto";

import {
  ActivityType,
  EmitResult,
  ProvJsonLd,
  ProvRecord,
  SolrProvDoc,
  VOYAGER_URN_NS,
} from "./types.js";
import { activityTypeURI, EMPTY_REMAP, RemapTable } from "./remap.js";

export interface EmitOptions {
  /** D110 register URI mapping. Defaults to the empty remap (Voyager-internal). */
  remap?: RemapTable;
}

const ACTIVITY_URN_PREFIX = `${VOYAGER_URN_NS}activity:` as const;

export function emit(record: ProvRecord, options: EmitOptions = {}): EmitResult {
  validate(record);
  const remap = options.remap ?? EMPTY_REMAP;
  const typeURI = activityTypeURI(record.activityType, remap);
  const activityId = deriveActivityId(record, typeURI);

  const usedSorted = [...record.used].sort();
  const generatedSorted = [...record.generated].sort();

  const jsonld: ProvJsonLd = {
    "@context": {
      prov: "http://www.w3.org/ns/prov#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
      voyager: VOYAGER_URN_NS,
    },
    "@id": activityId,
    "@type": "prov:Activity",
    "prov:type": { "@id": typeURI },
    "prov:wasAssociatedWith": { "@id": record.agent },
    "prov:used": usedSorted.map((id) => ({ "@id": id })),
    "prov:generated": generatedSorted.map((id) => ({ "@id": id })),
    "prov:startedAtTime": { "@value": record.startedAt, "@type": "xsd:dateTime" },
    "prov:endedAtTime": { "@value": record.endedAt, "@type": "xsd:dateTime" },
  };
  if (record.extra !== undefined) jsonld.extra = record.extra;

  const solrDoc: SolrProvDoc = {
    id: activityId,
    prov_id: activityId,
    prov_activityType: typeURI,
    prov_agent: record.agent,
    prov_used: usedSorted,
    prov_generated: generatedSorted,
    prov_startedAt: record.startedAt,
    prov_endedAt: record.endedAt,
    prov_jsonld: JSON.stringify(jsonld),
  };

  return { solrDoc, jsonld };
}

function validate(r: ProvRecord): void {
  if (!r.activityType) throw new Error("emit: activityType is required");
  if (!ACTIVITY_TYPES.has(r.activityType)) {
    throw new Error(
      `emit: unknown activityType '${r.activityType}'; expected one of ${[...ACTIVITY_TYPES].join(", ")}`
    );
  }
  if (!r.agent) throw new Error("emit: agent is required");
  if (!Array.isArray(r.used)) throw new Error("emit: used must be an array");
  if (!Array.isArray(r.generated)) throw new Error("emit: generated must be an array");
  if (!isoInstant(r.startedAt)) {
    throw new Error(`emit: startedAt must be ISO 8601 UTC (got '${r.startedAt}')`);
  }
  if (!isoInstant(r.endedAt)) {
    throw new Error(`emit: endedAt must be ISO 8601 UTC (got '${r.endedAt}')`);
  }
  if (Date.parse(r.startedAt) > Date.parse(r.endedAt)) {
    throw new Error("emit: startedAt must be <= endedAt");
  }
}

const ACTIVITY_TYPES = new Set<ActivityType>([
  // Layer 2 — RAG pipeline
  "connect",
  "extract",
  "chunk",
  "embed",
  "retrieve",
  "generate",
  // Layer 1 — HQ-side FAS enrichment
  "geotag",
  "classify-commodity",
  "classify-region",
  "nlp-extract-entities",
  "ocr",
  "field-normalize",
]);

// Accepts ISO 8601 with Z or ±HH:MM offset (Voyager feed provenance uses -08:00 etc).
// Millisecond precision optional.
const ISO_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function isoInstant(s: string): boolean {
  return typeof s === "string" && ISO_INSTANT_RE.test(s) && !Number.isNaN(Date.parse(s));
}

/**
 * Derive a deterministic activity URN from the identity-defining fields.
 * Retries with the same inputs converge on the same id; downstream Solr writes
 * overwrite instead of duplicating.
 */
function deriveActivityId(record: ProvRecord, typeURI: string): string {
  const identity = JSON.stringify([
    typeURI,
    record.agent,
    [...record.used].sort(),
    [...record.generated].sort(),
    record.startedAt,
    record.endedAt,
  ]);
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 32);
  return `${ACTIVITY_URN_PREFIX}${hash}`;
}
