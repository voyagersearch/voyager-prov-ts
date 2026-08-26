/**
 * SHACL gate for PROV JSON-LD (D100).
 *
 * Complements `validateProvJsonld()` (JSON Schema, envelope shape) with
 * graph-level constraints from `profile/prov-graph.shapes.ttl`: every
 * `prov:Activity` has exactly one `prov:type` IRI, exactly one
 * `prov:wasAssociatedWith` IRI, timestamps typed `xsd:dateTime`,
 * `prov:used[]` / `prov:generated[]` values are IRIs, and the activity `@id`
 * matches the Voyager URN slot (SPARQL shape).
 *
 * The shapes file is loaded once and cached at module scope — parsing the
 * turtle is not cheap and the shapes never change per-record.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import jsonld from "jsonld";
import { Parser as N3Parser } from "n3";
import SHACLValidator from "rdf-validate-shacl";
// rdf-validate-shacl needs an rdfjs environment that mixes data-model +
// dataset + namespace + term-set + clownface. Build one manually — the
// convenience `@rdfjs/environment-node` package no longer publishes and
// `rdf-ext` v2 dropped its clownface bundle. The pieces we combine below
// are exactly the peer deps rdf-validate-shacl declares.
// None of these packages ship .d.ts today, so we suppress per-import.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no type declarations for this factory package
import Environment from "@rdfjs/environment";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no type declarations for this factory package
import DataFactory from "@rdfjs/data-model/Factory.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no type declarations for this factory package
import DatasetFactory from "@rdfjs/dataset/Factory.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no type declarations for this factory package
import NamespaceFactory from "@rdfjs/namespace/Factory.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no type declarations for this factory package
import TermSetFactory from "@rdfjs/term-set/Factory.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no type declarations for this factory package
import TermMapFactory from "@rdfjs/term-map/Factory.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no type declarations for this factory package
import ClownfaceFactory from "clownface/Factory.js";

import type { ValidationError, ValidationResult } from "./validate.js";

// Minimal dataset shape we actually touch — enough for TypeScript, avoids
// pulling in the full @rdfjs/types dependency graph just for a return type.
type QuadLike = unknown;
interface DatasetLike {
  add(q: QuadLike): unknown;
}

// Shared rdfjs environment: exposes `.dataset()`, `.namedNode()`, and the
// `clownface` method that rdf-validate-shacl requires on the factory it's
// handed. Built once; cheap to reuse.
const env = new Environment([
  DataFactory,
  DatasetFactory,
  NamespaceFactory,
  TermSetFactory,
  TermMapFactory,
  ClownfaceFactory,
]);

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = resolve(HERE, "..", "src", "profile");
const PROFILE_DIR_ALT = resolve(HERE, "profile"); // when running compiled from dist/

const SHAPES_TTL_NAME = "prov-graph.shapes.ttl";

let shapesDatasetCache: DatasetLike | null = null;

async function loadShapesDataset(): Promise<DatasetLike> {
  if (shapesDatasetCache) return shapesDatasetCache;
  const candidates = [
    resolve(PROFILE_DIR, SHAPES_TTL_NAME),
    resolve(PROFILE_DIR_ALT, SHAPES_TTL_NAME),
  ];
  let ttl: string | null = null;
  for (const p of candidates) {
    try {
      ttl = readFileSync(p, "utf8");
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  if (ttl === null) {
    throw new Error(
      `voyager-prov: SHACL shapes '${SHAPES_TTL_NAME}' not found in profile/ dir`
    );
  }
  const parser = new N3Parser();
  const quads = parser.parse(ttl);
  const dataset = env.dataset();
  for (const q of quads) dataset.add(q);
  shapesDatasetCache = dataset;
  return dataset;
}

/**
 * Validate a PROV JSON-LD document (or an @graph / activities array) against
 * the D100 SHACL shapes. Returns `{ valid, errors }` matching the shape of
 * `validateProvJsonld()` so callers can compose both gates.
 *
 * Async because the JSON-LD → N-Quads conversion is async.
 */
export async function validateProvShapes(
  input: unknown
): Promise<ValidationResult> {
  if (input === null || (typeof input !== "object" && !Array.isArray(input))) {
    return {
      valid: false,
      errors: [
        {
          path: "/",
          message: `expected an object or array, got ${typeof input}`,
        },
      ],
    };
  }

  let nquads: string;
  try {
    nquads = (await jsonld.toRDF(input as jsonld.JsonLdDocument, {
      format: "application/n-quads",
    })) as unknown as string;
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          path: "/",
          message: `JSON-LD parse failed: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }

  const dataset = env.dataset();
  const parser = new N3Parser();
  for (const q of parser.parse(nquads)) dataset.add(q);

  const shapes = await loadShapesDataset();
  const validator = new SHACLValidator(shapes as never, { factory: env as never });
  // rdf-validate-shacl@≥0.6 returns a Promise from validate() when SPARQL
  // shapes are involved (our activity-URN pattern is one). Await either way.
  const report = await validator.validate(dataset as never);

  if (report.conforms) return { valid: true, errors: [] };

  const errors: ValidationError[] = [];
  for (const r of report.results) {
    const focus = r.focusNode?.value ?? "?";
    const path = r.path?.value ? ` · ${r.path.value}` : "";
    const rawMessages = r.message ?? [];
    const messages: string[] = Array.isArray(rawMessages)
      ? rawMessages.map((m) => (m as { value?: string }).value ?? "").filter(Boolean)
      : [(rawMessages as { value?: string }).value ?? ""];
    const message = messages.join("; ") || "SHACL violation";
    errors.push({ path: `${focus}${path}`, message });
  }
  return { valid: false, errors };
}
