import { describe, expect, it } from "vitest";

import {
  emit,
  entityURI,
  validateProvJsonld,
  validateProvRecord,
  type ProvRecord,
} from "../src/index.js";

const t0 = "2026-08-24T12:00:00Z";
const t1 = "2026-08-24T12:00:01Z";

function goodRecord(): unknown {
  return {
    activity_type: "chunk",
    agent: "urn:voyager:agent:mastra-chunker@1.0.0",
    used: [entityURI("extracted-content", "P1")],
    generated: [entityURI("chunk", "P1_0")],
    started_at: t0,
    ended_at: t1,
  };
}

describe("validateProvRecord — JSON Schema over the input shape", () => {
  it("accepts a well-formed record", () => {
    const r = validateProvRecord(goodRecord());
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it("rejects a missing required field", () => {
    const bad = { ...(goodRecord() as Record<string, unknown>) };
    delete bad.agent;
    const r = validateProvRecord(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /agent/.test(e.message))).toBe(true);
  });

  it("rejects an unknown activity_type", () => {
    const bad = { ...(goodRecord() as Record<string, unknown>), activity_type: "nope" };
    const r = validateProvRecord(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path.endsWith("/activity_type"))).toBe(true);
  });

  it("rejects a malformed timestamp", () => {
    const bad = { ...(goodRecord() as Record<string, unknown>), started_at: "yesterday" };
    const r = validateProvRecord(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path.endsWith("/started_at"))).toBe(true);
  });

  it("rejects extra properties (schema is closed against typos)", () => {
    const bad = { ...(goodRecord() as Record<string, unknown>), agnet: "typo" };
    const r = validateProvRecord(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /additional/.test(e.message))).toBe(true);
  });

  it("accepts an optional `extra` object", () => {
    const withExtra = { ...(goodRecord() as Record<string, unknown>), extra: { model: "haiku-4.5" } };
    const r = validateProvRecord(withExtra);
    expect(r).toEqual({ valid: true, errors: [] });
  });
});

describe("validateProvJsonld — JSON Schema over emit()'s output", () => {
  const rec: ProvRecord = {
    activityType: "chunk",
    agent: "urn:voyager:agent:mastra-chunker@1.0.0",
    used: [entityURI("extracted-content", "P1")],
    generated: [entityURI("chunk", "P1_0")],
    startedAt: t0,
    endedAt: t1,
  };

  it("validates every JSON-LD emit() produces", () => {
    const { jsonld } = emit(rec);
    const r = validateProvJsonld(jsonld);
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it("rejects a JSON-LD blob with a bogus @id shape", () => {
    const { jsonld } = emit(rec);
    const bad = { ...jsonld, "@id": "not-a-voyager-urn" };
    const r = validateProvJsonld(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === "/@id")).toBe(true);
  });

  it("rejects a JSON-LD blob missing prov:type", () => {
    const { jsonld } = emit(rec);
    const bad: Record<string, unknown> = { ...jsonld };
    delete bad["prov:type"];
    const r = validateProvJsonld(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /prov:type/.test(e.message))).toBe(true);
  });

  it("rejects a startedAtTime that isn't a proper xsd:dateTime literal", () => {
    const { jsonld } = emit(rec);
    const bad = {
      ...jsonld,
      "prov:startedAtTime": { "@value": "yesterday", "@type": "xsd:dateTime" },
    };
    const r = validateProvJsonld(bad);
    expect(r.valid).toBe(false);
  });
});
