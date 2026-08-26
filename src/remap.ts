/**
 * Voyager-internal → D110 register URI remap.
 *
 * D110 publishes canonical URIs for the process types the profile talks
 * about (e.g. `https://d110.ogc.org/registers/prov-activity/embed`). Until
 * that register is stable, `emit()` writes `VOYAGER_ACTIVITY_NS + activityType`.
 * Callers get D110 URIs at emit time by setting `PROV_REGISTER_MAP` in the
 * environment before the package is imported — no code change on any
 * emission site.
 *
 * PROV_REGISTER_MAP can point to either:
 *   - a local JSON file whose contents are a `RemapTable` (the usual case
 *     inside a container: mount the file, point the env at it), or
 *   - a JSON string (`PROV_REGISTER_MAP='{"chunk":"..."}'` — handy for tests).
 *
 * Missing / unreadable / malformed → falls back silently to the internal
 * namespace, matching the behaviour when nothing is set. Emission MUST NOT
 * fail because a register can't be loaded.
 */

import { existsSync, readFileSync } from "node:fs";

import { ActivityType, VOYAGER_ACTIVITY_NS } from "./types.js";

/**
 * A partial map — only the activityTypes with a known D110 register URI need
 * to be present. Missing entries fall back to the Voyager-internal namespace.
 */
export type RemapTable = Partial<Record<ActivityType, string>>;

/**
 * The empty remap — no D110 URIs known. Passing this to `activityTypeURI`
 * is equivalent to passing `undefined`; both resolve to the internal namespace.
 */
export const EMPTY_REMAP: RemapTable = Object.freeze({});

/** Env var callers set at deploy time to route emissions through a register. */
export const REGISTER_ENV_VAR = "PROV_REGISTER_MAP";

function loadRemapFromEnv(): RemapTable {
  const raw = process.env[REGISTER_ENV_VAR];
  if (!raw || raw.trim() === "") return EMPTY_REMAP;
  const text = raw.trim().startsWith("{") ? raw : safeReadFile(raw);
  if (text == null) return EMPTY_REMAP;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.freeze(parsed) as RemapTable;
    }
  } catch (err) {
    // Never let a bad env value break emit(). Log once to stderr.
    console.error(
      `[voyager-prov] failed to parse ${REGISTER_ENV_VAR} (${err instanceof Error ? err.message : err}); falling back to internal namespace.`
    );
  }
  return EMPTY_REMAP;
}

function safeReadFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Resolved once at module import — flipping the register at runtime means
 * restarting the process, which is the deploy contract we want anyway
 * (the same records shouldn't switch namespaces mid-run and produce two
 * different activity URNs for the same emission).
 */
export const DEFAULT_REMAP: RemapTable = loadRemapFromEnv();

/**
 * If a mapping entry exists for `activityType`, returns the register URI.
 * Otherwise returns the Voyager-internal URI (namespace + activityType).
 *
 * When called without an explicit `remap`, uses whatever `DEFAULT_REMAP`
 * resolved to at import time (env-driven). Pass a `remap` explicitly to
 * override — useful for tests or for a caller that keeps both URIs around.
 */
export function activityTypeURI(
  activityType: ActivityType,
  remap?: RemapTable
): string {
  const source = remap ?? DEFAULT_REMAP;
  const mapped = source[activityType];
  return mapped ?? `${VOYAGER_ACTIVITY_NS}${activityType}`;
}
