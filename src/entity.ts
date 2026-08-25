/**
 * Deterministic entity URIs.
 *
 * PROV entities in the RAG pipeline (chunks, embeddings, retrieved-results,
 * answers) have stable natural ids upstream (chunk id, doc id, query hash).
 * We prefix them with a kind + Voyager URN namespace so consumers can
 * dereference and reason about kind without parsing the id shape.
 *
 * Format: `urn:voyager:prov:entity:<kind>:<id>`
 *
 * `kind` is namespaced but free-form to allow future workflows to add new
 * entity classes without touching this module. `id` is passed through unchanged
 * — callers pre-normalize (lowercase, strip whitespace) if they need canonical
 * equivalence.
 */

import { VOYAGER_URN_NS } from "./types.js";

const ENTITY_PREFIX = `${VOYAGER_URN_NS}entity:` as const;

export function entityURI(kind: string, id: string): string {
  if (!kind) throw new Error("entityURI: kind is required");
  if (!id) throw new Error("entityURI: id is required");
  // Reject characters that would confuse URN parsers or downstream URL usage.
  if (/[\s#?]/.test(kind) || /[\s#?]/.test(id)) {
    throw new Error("entityURI: kind and id must not contain whitespace, '#', or '?'");
  }
  return `${ENTITY_PREFIX}${kind}:${id}`;
}
