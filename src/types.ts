/**
 * PROV record shapes used by voyager-prov-ts.
 *
 * Loose W3C PROV concepts (Activity, Agent, Entity, wasStartedAt, used, generated)
 * shaped for the D100 Workflow Profiler deliverable. Not a full W3C PROV binding —
 * only the subset the Voyager RAG pipeline emits.
 */

/**
 * activityType stubs emitted by Voyager pipelines.
 *
 * Layer 2 (RAG pipeline, main plan): connect | extract | chunk | embed | retrieve | generate.
 * Layer 1 (HQ-side FAS enrichment, Appendix A): geotag | classify-commodity |
 * classify-region | nlp-extract-entities | ocr | field-normalize.
 *
 * When D110's register hardens, `remap()` swaps any of these to register URIs
 * at emission time — the shape is stable across both layers.
 */
export type ActivityType =
  // Layer 2 — RAG pipeline
  | "connect"
  | "extract"
  | "chunk"
  | "embed"
  | "retrieve"
  | "generate"
  // Layer 1 — HQ-side FAS enrichment ops (CFP §5.1 geospatial-ops alignment)
  | "geotag"
  | "classify-commodity"
  | "classify-region"
  | "nlp-extract-entities"
  | "ocr"
  | "field-normalize";

/** Voyager-internal namespace for activityType URIs, remapped to D110 at demo time. */
export const VOYAGER_ACTIVITY_NS = "https://voyager.ogc/prov/activity/" as const;

/** Voyager-internal namespace for entity + activity URNs (deterministic hashes). */
export const VOYAGER_URN_NS = "urn:voyager:prov:" as const;

/**
 * Input to `emit()`. The caller supplies stable, semantically-meaningful values;
 * `emit()` computes the activity URN as a hash so retries overwrite by id.
 */
export interface ProvRecord {
  /** One of the six RAG pipeline activity types (see ActivityType). */
  activityType: ActivityType;
  /** Agent URI — connector implementation, service, or model. Stable per role. */
  agent: string;
  /** Entity URIs this activity consumed. Order-insensitive; hashed sorted. */
  used: string[];
  /** Entity URIs this activity produced. Order-insensitive; hashed sorted. */
  generated: string[];
  /** ISO 8601 UTC timestamp. Prefer millisecond precision. */
  startedAt: string;
  /** ISO 8601 UTC timestamp. */
  endedAt: string;
  /**
   * Extra properties dropped into the JSON-LD blob but NOT into the deterministic
   * activity URN. Use for provenance-relevant metadata that varies without
   * affecting identity (e.g. model temperature, chunk count).
   */
  extra?: Record<string, unknown>;
}

/**
 * `emit()` output. `solrDoc` is ready for Solr indexing (matches D100 § Step 3
 * schema fields on the `main` collection). `jsonld` is W3C PROV-JSON-LD.
 */
export interface EmitResult {
  solrDoc: SolrProvDoc;
  jsonld: ProvJsonLd;
}

export interface SolrProvDoc {
  id: string;
  prov_id: string;
  prov_activityType: string;
  prov_agent: string;
  prov_used: string[];
  prov_generated: string[];
  prov_startedAt: string;
  prov_endedAt: string;
  prov_jsonld: string;
}

/**
 * Minimal PROV-JSON-LD shape. Not a full W3C PROV binding — carries just the
 * fields the D100 validation harness (JSON Schema + SHACL) inspects.
 */
export interface ProvJsonLd {
  "@context": {
    prov: "http://www.w3.org/ns/prov#";
    xsd: "http://www.w3.org/2001/XMLSchema#";
    voyager: typeof VOYAGER_URN_NS;
  };
  "@id": string;
  "@type": "prov:Activity";
  "prov:type": { "@id": string };
  "prov:wasAssociatedWith": { "@id": string };
  "prov:used": Array<{ "@id": string }>;
  "prov:generated": Array<{ "@id": string }>;
  "prov:startedAtTime": { "@value": string; "@type": "xsd:dateTime" };
  "prov:endedAtTime": { "@value": string; "@type": "xsd:dateTime" };
  extra?: Record<string, unknown>;
}
