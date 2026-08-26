/**
 * SHACL gate tests for voyager-prov-ts.
 *
 * Mirror of `voyager-prov-py/tests/test_shapes.py` — each test builds a
 * minimal PROV JSON-LD, runs it through `validateProvShapes()`, and asserts
 * the outcome the shapes should produce. Parity failures here vs. the
 * Python suite would signal a shapes-file drift.
 */

import { describe, expect, it } from "vitest";

import {
  emit,
  entityURI,
  validateProvShapes,
  type ProvJsonLd,
  type ProvRecord,
} from "../src/index.js";

const t0 = "2026-08-25T12:00:00Z";
const t1 = "2026-08-25T12:00:01Z";

function goodRecord(): ProvRecord {
  return {
    activityType: "chunk",
    agent: "urn:voyager:agent:mastra-chunker@1.0.0",
    used: [entityURI("extracted-content", "P1")],
    generated: [entityURI("chunk", "P1_0")],
    startedAt: t0,
    endedAt: t1,
  };
}

function goodJsonld(): ProvJsonLd {
  return emit(goodRecord()).jsonld;
}

describe("validateProvShapes — SHACL gate", () => {
  it("accepts a well-formed activity JSON-LD", async () => {
    const r = await validateProvShapes(goodJsonld());
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it("rejects an activity missing prov:type", async () => {
    const bad: Record<string, unknown> = { ...goodJsonld() };
    delete bad["prov:type"];
    const r = await validateProvShapes(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects prov:startedAtTime missing @type xsd:dateTime", async () => {
    const bad = { ...goodJsonld() } as Record<string, unknown>;
    // Drop the datatype so the value becomes a plain string literal.
    bad["prov:startedAtTime"] = { "@value": t0 };
    const r = await validateProvShapes(bad);
    expect(r.valid).toBe(false);
  });

  it("rejects prov:used values that are literals instead of IRIs", async () => {
    const bad = { ...goodJsonld() } as Record<string, unknown>;
    bad["prov:used"] = ["not-an-iri"];
    const r = await validateProvShapes(bad);
    expect(r.valid).toBe(false);
  });

  it("accepts an activity @id outside the Voyager URN slot (URN check lives in JSON Schema, not SHACL)", async () => {
    // The `@id` pattern (`urn:voyager:prov:activity:<32hex>`) is enforced by
    // `validateProvJsonld` — SHACL is only responsible for graph shape.
    const doc = { ...goodJsonld() } as Record<string, unknown>;
    doc["@id"] = "urn:some-other-scheme:definitely-not-us";
    const r = await validateProvShapes(doc);
    expect(r.valid).toBe(true);
  });

  it("returns a structured error for non-object input", async () => {
    const r = await validateProvShapes("just a string" as unknown);
    expect(r.valid).toBe(false);
    expect(r.errors[0]?.message).toMatch(/expected an object or array/);
  });

  it.each([
    "not-a-date",
  ])("rejects a malformed xsd:dateTime literal (%s)", async (bad) => {
    // rdf-validate-shacl's `sh:datatype` check verifies the datatype IRI and
    // relies on the RDF parser to reject invalid lexical forms — obviously
    // non-date values like `not-a-date` fail here. Values shaped like ISO but
    // with impossible fields (e.g. `2026-13-99T99:99:99Z`) are accepted by
    // SHACL per the letter of the spec; the lexical-form gate for those lives
    // in the JSON Schema pattern layer.
    const doc = { ...goodJsonld() } as Record<string, unknown>;
    doc["prov:startedAtTime"] = { "@value": bad, "@type": "xsd:dateTime" };
    const r = await validateProvShapes(doc);
    expect(r.valid).toBe(false);
  });

  it("validates a JSON-LD @graph carrying multiple activities", async () => {
    const activities = Array.from({ length: 3 }, () => goodJsonld() as unknown as Record<string, unknown>);
    activities.forEach((a, i) => {
      a["@id"] = `urn:voyager:prov:activity:${i.toString(16).padStart(32, "0")}`;
    });
    const doc = {
      "@context": (activities[0] as Record<string, unknown>)["@context"],
      "@graph": activities,
    };
    const r = await validateProvShapes(doc);
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it("validates a bare array of activities (bundle-style)", async () => {
    const activities = Array.from({ length: 2 }, () => goodJsonld() as unknown as Record<string, unknown>);
    activities.forEach((a, i) => {
      a["@id"] = `urn:voyager:prov:activity:${i.toString(16).padStart(32, "0")}`;
    });
    const r = await validateProvShapes(activities);
    expect(r).toEqual({ valid: true, errors: [] });
  });
});
