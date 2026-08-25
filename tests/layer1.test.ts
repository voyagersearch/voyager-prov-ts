/**
 * Layer 1 (HQ-side FAS enrichment) activity-type coverage.
 *
 * Layer 2 (RAG pipeline) types are exercised by emit.test.ts + validate.test.ts.
 * This file asserts each new Layer 1 type emits, validates, and round-trips
 * through the same code paths — so the FAS enrichment ops CFP §5.1 cares
 * about are the same product as the RAG-side emissions.
 */

import { describe, expect, it } from "vitest";

import {
  activityTypeURI,
  emit,
  entityURI,
  VOYAGER_ACTIVITY_NS,
  validateProvJsonld,
  validateProvRecord,
  type ActivityType,
  type ProvRecord,
} from "../src/index.js";

const t0 = "2026-08-25T12:00:00Z";
const t1 = "2026-08-25T12:00:01Z";

const LAYER_1_TYPES: ActivityType[] = [
  "geotag",
  "classify-commodity",
  "classify-region",
  "nlp-extract-entities",
  "ocr",
  "field-normalize",
];

function fasRecord(activityType: ActivityType): ProvRecord {
  return {
    activityType,
    agent: `urn:voyager:agent:hq-step:${activityType}`,
    used: [entityURI("indexed-doc", "fas_wap_argentina_2026Q3")],
    generated: [entityURI("indexed-doc", "fas_wap_argentina_2026Q3+enriched")],
    startedAt: t0,
    endedAt: t1,
  };
}

describe("Layer 1 activity types — emit()", () => {
  it.each(LAYER_1_TYPES)("emits a valid Solr doc for %s", (activityType) => {
    const { solrDoc, jsonld } = emit(fasRecord(activityType));
    expect(solrDoc.prov_activityType).toBe(`${VOYAGER_ACTIVITY_NS}${activityType}`);
    expect(jsonld["prov:type"]["@id"]).toBe(`${VOYAGER_ACTIVITY_NS}${activityType}`);
    expect(solrDoc.id).toMatch(/^urn:voyager:prov:activity:[0-9a-f]{32}$/);
  });

  it("distinct Layer 1 types produce distinct activity URNs on the same subject", () => {
    const ids = new Set(LAYER_1_TYPES.map((t) => emit(fasRecord(t)).solrDoc.id));
    expect(ids.size).toBe(LAYER_1_TYPES.length);
  });
});

describe("Layer 1 activity types — validateProvRecord + validateProvJsonld", () => {
  it.each(LAYER_1_TYPES)("record validates for %s", (activityType) => {
    const r = validateProvRecord({
      activity_type: activityType,
      agent: `urn:voyager:agent:hq-step:${activityType}`,
      used: [entityURI("indexed-doc", "P1")],
      generated: [entityURI("indexed-doc", "P1+enriched")],
      started_at: t0,
      ended_at: t1,
    });
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it.each(LAYER_1_TYPES)("emit output validates for %s", (activityType) => {
    const { jsonld } = emit(fasRecord(activityType));
    const r = validateProvJsonld(jsonld);
    expect(r).toEqual({ valid: true, errors: [] });
  });
});

describe("Layer 1 activity types — remap", () => {
  it("classify-commodity + classify-region + geotag remap to D110-style URIs when configured", () => {
    const remap = {
      "classify-commodity": "https://d110.ogc.org/registers/prov-activity/classify-commodity",
      "classify-region": "https://d110.ogc.org/registers/prov-activity/classify-region",
      geotag: "https://d110.ogc.org/registers/prov-activity/geotag",
    } as const;
    expect(activityTypeURI("classify-commodity", remap)).toBe(remap["classify-commodity"]);
    expect(activityTypeURI("classify-region", remap)).toBe(remap["classify-region"]);
    expect(activityTypeURI("geotag", remap)).toBe(remap.geotag);
    // Unmapped Layer 1 types stay on the Voyager-internal namespace.
    expect(activityTypeURI("ocr", remap)).toBe(`${VOYAGER_ACTIVITY_NS}ocr`);
  });
});
