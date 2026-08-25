/**
 * JSON Schema validation for voyager-prov records.
 *
 * Two validators — one for the input `ProvRecord`, one for the JSON-LD output.
 * The D100 validation harness runs both on every emitted record in CI. SHACL
 * shape validation is documented in prov-graph.shapes.ttl but not wired in
 * this module — running SHACL from JS requires pulling in a full RDF stack
 * (`rdf-validate-shacl`, `n3`) which is optional for v0.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

import type { ProvJsonLd, ProvRecord } from "./types.js";

/** One JSON Schema violation with a stable message + location. */
export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = resolve(HERE, "..", "src", "profile");
const PROFILE_DIR_ALT = resolve(HERE, "profile"); // when running from src/ directly

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const recordSchema = loadJson("prov-record.schema.json");
const jsonldSchema = loadJson("prov-jsonld.schema.json");

const validateRecordFn: ValidateFunction<ProvRecord> = ajv.compile(recordSchema);
const validateJsonldFn: ValidateFunction<ProvJsonLd> = ajv.compile(jsonldSchema);

export function validateProvRecord(record: unknown): ValidationResult {
  return run(validateRecordFn, record);
}

export function validateProvJsonld(jsonld: unknown): ValidationResult {
  return run(validateJsonldFn, jsonld);
}

function run(fn: ValidateFunction<unknown>, data: unknown): ValidationResult {
  const ok = fn(data);
  if (ok) return { valid: true, errors: [] };
  const errors: ValidationError[] = (fn.errors ?? []).map(shapeError);
  return { valid: false, errors };
}

function shapeError(e: ErrorObject): ValidationError {
  const path = e.instancePath === "" ? "/" : e.instancePath;
  return { path, message: e.message ?? "invalid" };
}

/** Read one JSON file from the packaged profile/ directory. */
function loadJson(name: string): AnySchema {
  const candidates = [resolve(PROFILE_DIR, name), resolve(PROFILE_DIR_ALT, name)];
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, "utf8")) as AnySchema;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  throw new Error(`voyager-prov: schema '${name}' not found in profile/ dir`);
}
