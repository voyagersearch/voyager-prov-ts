/**
 * Env-driven DEFAULT_REMAP tests.
 *
 * `DEFAULT_REMAP` is resolved once at module import — `activityTypeURI()`'s
 * default arg reflects whatever the env said at that moment. To exercise the
 * import-time load, each test sets `PROV_REGISTER_MAP`, calls
 * `vi.resetModules()` so the next dynamic import re-runs the module
 * top-level, and then re-imports the package and reads the resolved URI.
 * The tests never mutate `DEFAULT_REMAP` after import — that's not how the
 * deploy contract works.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module under test is imported dynamically per case so `resetModules()`
// forces the top-level `loadRemapFromEnv()` to run again.
async function importAndResolve(): Promise<string> {
  const m = await import("../src/index.js");
  return m.activityTypeURI("chunk");
}

describe("DEFAULT_REMAP — env-driven register load", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("resolves to internal namespace when env is unset", async () => {
    vi.stubEnv("PROV_REGISTER_MAP", "");
    expect(await importAndResolve()).toBe("https://voyager.ogc/prov/activity/chunk");
  });

  it("resolves to a D110 URI when env holds a JSON string", async () => {
    vi.stubEnv(
      "PROV_REGISTER_MAP",
      '{"chunk":"https://d110.ogc.org/registers/prov-activity/chunk"}'
    );
    expect(await importAndResolve()).toBe(
      "https://d110.ogc.org/registers/prov-activity/chunk"
    );
  });

  it("resolves to a D110 URI when env points to a JSON file", async () => {
    const dir = join(tmpdir(), `prov-remap-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "d110.json");
    writeFileSync(
      file,
      JSON.stringify({ chunk: "https://d110.ogc.org/registers/prov-activity/chunk" }),
      "utf8"
    );
    vi.stubEnv("PROV_REGISTER_MAP", file);
    expect(await importAndResolve()).toBe(
      "https://d110.ogc.org/registers/prov-activity/chunk"
    );
  });

  it("falls back to internal namespace on malformed JSON — never throws", async () => {
    vi.stubEnv("PROV_REGISTER_MAP", "{this-is-not-json");
    expect(await importAndResolve()).toBe("https://voyager.ogc/prov/activity/chunk");
  });

  it("falls back to internal namespace when the file path doesn't exist", async () => {
    vi.stubEnv("PROV_REGISTER_MAP", "/no/such/file/here.json");
    expect(await importAndResolve()).toBe("https://voyager.ogc/prov/activity/chunk");
  });

  it("emit() picks up DEFAULT_REMAP without an explicit remap arg", async () => {
    vi.stubEnv(
      "PROV_REGISTER_MAP",
      '{"chunk":"https://d110.ogc.org/registers/prov-activity/chunk"}'
    );
    const { emit, entityURI } = await import("../src/index.js");
    const { solrDoc } = emit({
      activityType: "chunk",
      agent: "urn:voyager:agent:test",
      used: [entityURI("indexed-doc", "P1+enriched")],
      generated: [entityURI("chunk", "P1_0")],
      startedAt: "2026-08-25T12:00:00Z",
      endedAt: "2026-08-25T12:00:01Z",
    });
    expect(solrDoc.prov_activityType).toBe(
      "https://d110.ogc.org/registers/prov-activity/chunk"
    );
  });
});
