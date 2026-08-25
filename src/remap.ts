/**
 * Voyager-internal → D110 register URI remap.
 *
 * At demo time, D110 publishes a Building Block register of process types
 * (e.g. `https://d110.ogc.org/registers/prov-activity/embed`). Until then,
 * `emit()` writes `VOYAGER_ACTIVITY_NS + activityType`. This module holds the
 * mapping and applies it if configured; otherwise it returns the Voyager URI
 * unchanged.
 *
 * The remap is intentionally NOT baked into `emit()` — callers may want to
 * keep both URIs (Voyager-internal for local queries, D110 URI for standards
 * conformance) or resolve lazily at query time.
 */

import { ActivityType, VOYAGER_ACTIVITY_NS } from "./types.js";

/**
 * If a mapping entry exists for `activityType`, returns the D110 register URI.
 * Otherwise returns the Voyager-internal URI (namespace + activityType).
 */
export function activityTypeURI(
  activityType: ActivityType,
  remap?: RemapTable
): string {
  const mapped = remap?.[activityType];
  return mapped ?? `${VOYAGER_ACTIVITY_NS}${activityType}`;
}

/**
 * A partial map — only the activityTypes with a known D110 register URI need
 * to be present. Missing entries fall back to the Voyager-internal namespace.
 */
export type RemapTable = Partial<Record<ActivityType, string>>;

/**
 * The empty remap — no D110 URIs known yet. Ship this as the package default
 * until D110's register is published, then callers pass their loaded map in.
 */
export const EMPTY_REMAP: RemapTable = Object.freeze({});
