import { describe, expect, it } from "vitest";

import {
  activityTypeURI,
  EMPTY_REMAP,
  emit,
  entityURI,
  VOYAGER_ACTIVITY_NS,
  VOYAGER_URN_NS,
  type ProvRecord,
  type RemapTable,
} from "../src/index.js";

const t0 = "2026-08-24T12:00:00Z";
const t1 = "2026-08-24T12:00:01Z";

function baseRecord(): ProvRecord {
  return {
    activityType: "chunk",
    agent: "urn:voyager:agent:mastra-chunker@1.0.0",
    used: [entityURI("extracted-content", "AS_2226000_2026_178")],
    generated: [
      entityURI("chunk", "AS_2226000_2026_178_0"),
      entityURI("chunk", "AS_2226000_2026_178_1"),
    ],
    startedAt: t0,
    endedAt: t1,
  };
}

describe("entityURI", () => {
  it("returns deterministic urns of shape urn:voyager:prov:entity:<kind>:<id>", () => {
    expect(entityURI("chunk", "abc")).toBe("urn:voyager:prov:entity:chunk:abc");
    expect(entityURI("chunk", "abc")).toBe(entityURI("chunk", "abc"));
  });

  it("rejects empty kind or id", () => {
    expect(() => entityURI("", "x")).toThrow(/kind is required/);
    expect(() => entityURI("k", "")).toThrow(/id is required/);
  });

  it("rejects kind or id with url-hostile characters", () => {
    expect(() => entityURI("k ind", "x")).toThrow(/whitespace/);
    expect(() => entityURI("kind", "x#y")).toThrow(/whitespace|'#'|'\?'/);
    expect(() => entityURI("kind", "x?y")).toThrow(/whitespace|'#'|'\?'/);
  });
});

describe("activityTypeURI", () => {
  it("returns Voyager-internal URI when no remap entry present", () => {
    expect(activityTypeURI("embed", EMPTY_REMAP)).toBe(`${VOYAGER_ACTIVITY_NS}embed`);
  });

  it("returns remapped URI when the table has an entry", () => {
    const remap: RemapTable = { embed: "https://d110.ogc.org/registers/prov-activity/embed" };
    expect(activityTypeURI("embed", remap)).toBe(
      "https://d110.ogc.org/registers/prov-activity/embed"
    );
  });

  it("falls back for un-mapped types even when other entries are present", () => {
    const remap: RemapTable = { embed: "https://x/embed" };
    expect(activityTypeURI("chunk", remap)).toBe(`${VOYAGER_ACTIVITY_NS}chunk`);
  });
});

describe("emit", () => {
  it("returns solrDoc + jsonld both anchored on the same activity URN", () => {
    const { solrDoc, jsonld } = emit(baseRecord());
    expect(solrDoc.id).toBe(solrDoc.prov_id);
    expect(jsonld["@id"]).toBe(solrDoc.id);
    expect(solrDoc.id.startsWith(`${VOYAGER_URN_NS}activity:`)).toBe(true);
  });

  it("stamps activityType with Voyager-internal URI by default", () => {
    const { solrDoc, jsonld } = emit(baseRecord());
    expect(solrDoc.prov_activityType).toBe(`${VOYAGER_ACTIVITY_NS}chunk`);
    expect(jsonld["prov:type"]["@id"]).toBe(`${VOYAGER_ACTIVITY_NS}chunk`);
  });

  it("swaps activityType URI when a remap is supplied", () => {
    const remap: RemapTable = { chunk: "https://d110.ogc.org/registers/prov-activity/chunk" };
    const { solrDoc, jsonld } = emit(baseRecord(), { remap });
    expect(solrDoc.prov_activityType).toBe(remap.chunk);
    expect(jsonld["prov:type"]["@id"]).toBe(remap.chunk);
  });

  it("sorts used and generated so identity is order-insensitive", () => {
    const r1 = baseRecord();
    const r2 = { ...baseRecord(), generated: [...baseRecord().generated].reverse() };
    expect(emit(r1).solrDoc.id).toBe(emit(r2).solrDoc.id);
    expect(emit(r1).solrDoc.prov_generated).toEqual(emit(r2).solrDoc.prov_generated);
  });

  it("is idempotent: same identity inputs → same activity id (safe to retry)", () => {
    const a = emit(baseRecord());
    const b = emit(baseRecord());
    expect(a.solrDoc.id).toBe(b.solrDoc.id);
    expect(a.solrDoc.prov_jsonld).toBe(b.solrDoc.prov_jsonld);
  });

  it("does not include `extra` in the activity id (extra is metadata, not identity)", () => {
    const withExtra = emit({ ...baseRecord(), extra: { temperature: 0.7 } });
    const without = emit(baseRecord());
    expect(withExtra.solrDoc.id).toBe(without.solrDoc.id);
    expect(withExtra.jsonld.extra).toEqual({ temperature: 0.7 });
    expect(without.jsonld.extra).toBeUndefined();
  });

  it("uses ISO 8601 in prov:startedAtTime with xsd:dateTime datatype", () => {
    const { jsonld } = emit(baseRecord());
    expect(jsonld["prov:startedAtTime"]).toEqual({ "@value": t0, "@type": "xsd:dateTime" });
    expect(jsonld["prov:endedAtTime"]).toEqual({ "@value": t1, "@type": "xsd:dateTime" });
  });

  it("carries `used` and `generated` as JSON-LD @id refs", () => {
    const { jsonld } = emit(baseRecord());
    expect(jsonld["prov:used"]).toEqual([
      { "@id": "urn:voyager:prov:entity:extracted-content:AS_2226000_2026_178" },
    ]);
    expect(jsonld["prov:generated"]).toEqual([
      { "@id": "urn:voyager:prov:entity:chunk:AS_2226000_2026_178_0" },
      { "@id": "urn:voyager:prov:entity:chunk:AS_2226000_2026_178_1" },
    ]);
  });

  it("rejects unknown activityType values", () => {
    // @ts-expect-error — deliberately invalid at runtime.
    expect(() => emit({ ...baseRecord(), activityType: "nope" })).toThrow(/unknown activityType/);
  });

  it("rejects missing required fields", () => {
    expect(() => emit({ ...baseRecord(), agent: "" })).toThrow(/agent is required/);
    expect(() => emit({ ...baseRecord(), used: undefined as unknown as string[] })).toThrow(
      /used must be an array/
    );
  });

  it("rejects malformed timestamps and inverted intervals", () => {
    expect(() => emit({ ...baseRecord(), startedAt: "yesterday" })).toThrow(
      /startedAt must be ISO 8601/
    );
    expect(() =>
      emit({ ...baseRecord(), startedAt: t1, endedAt: t0 })
    ).toThrow(/startedAt must be <= endedAt/);
  });

  it("accepts timezone-offset ISO 8601 (matches Voyager feed provenance dates)", () => {
    const started = "2026-08-24T04:00:00-08:00";
    const ended = "2026-08-24T04:00:01-08:00";
    expect(() => emit({ ...baseRecord(), startedAt: started, endedAt: ended })).not.toThrow();
  });

  it("prov_jsonld field parses back to the same object as the returned jsonld", () => {
    const { solrDoc, jsonld } = emit(baseRecord());
    expect(JSON.parse(solrDoc.prov_jsonld)).toEqual(jsonld);
  });
});
