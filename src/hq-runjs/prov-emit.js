// voyager-prov — HQ runJavaScript emitter (Layer 1 / FAS enrichment).
//
// A self-contained emitter that runs inside Voyager HQ 3.x's runJavaScript
// pipeline step. It mirrors voyager-prov-ts's `emit()` byte-for-byte: same
// SolrProvDoc shape, same SHA-256 activity URN, same JSON-LD blob — so records
// written from HQ pipelines round-trip through the same validator, register,
// and demonstrator as records emitted from mastra/embedder.
//
// Wiring (see docs/hq-integration.md or Appendix A of the D100 plan):
//   1. Each of the 6 demo-fas-showcase enrichment steps that we want to
//      profile is followed by a runJavaScript step whose `script` includes
//      the body of this file (the runJavaScript step's `entry` API mutates
//      the incoming doc; here we ADDITIONALLY write a sidecar file).
//   2. The step's `params` block sets four things:
//        activityType     — one of the 12 activity types (see below)
//        agent            — URN of this pipeline step
//        usedField        — which entry field to hash as the `used` entity
//        generatedField   — which entry field to hash as the `generated` entity
//      Defaults sit in HQ_PROV_DEFAULTS.
//   3. This file writes each PROV record to
//      `${HQ_PROV_ROOT}/${HQ_PROV_SUBPATH}/<activity-urn>.json`. The existing
//      demo-prov-passthrough folder repo re-indexes these into the `main`
//      Solr collection unchanged.
//
// NB: this runs in Voyager's JS engine (Nashorn/GraalJS). Nashorn quirks:
//   - Concatenating strings with '+' is fine.
//   - Java array of doubles must be wrapped in ArrayList — same trap as the
//     `vec_384_ollama` write path (see D100 plan Session Learnings).
//   - JSON.stringify is available.
//   - No fetch(), no Promise — everything is synchronous.

(function () {
  // ------ Constants (match voyager-prov-ts) ------
  var VOYAGER_ACTIVITY_NS = "https://voyager.ogc/prov/activity/";
  var VOYAGER_URN_NS = "urn:voyager:prov:";
  var ACTIVITY_URN_PREFIX = VOYAGER_URN_NS + "activity:";
  var ENTITY_URN_PREFIX = VOYAGER_URN_NS + "entity:";

  var VALID_ACTIVITY_TYPES = {
    // Layer 2
    connect: true, extract: true, chunk: true, embed: true, retrieve: true, generate: true,
    // Layer 1
    geotag: true, "classify-commodity": true, "classify-region": true,
    "nlp-extract-entities": true, ocr: true, "field-normalize": true
  };

  // Env-driven sink path. See HQ_PROV_* env keys in Appendix A.
  var HQ_PROV_ROOT_DIR = (typeof HQ_PROV_ROOT_DIR !== "undefined")
    ? HQ_PROV_ROOT_DIR
    : "/hq/home/py/test_data/prov";

  // ------ Java bridges ------
  var Files = java.nio.file.Files;
  var Paths = java.nio.file.Paths;
  var StandardOpenOption = java.nio.file.StandardOpenOption;
  var MessageDigest = java.security.MessageDigest;
  var Instant = java.time.Instant;
  var ArrayList = java.util.ArrayList;
  var StandardCharsets = java.nio.charset.StandardCharsets;

  // ------ Public API attached to the pipeline entry context ------
  //
  // Callers invoke `voyagerProv.emit(entry, params)` at the end of their
  // runJavaScript step. `entry` is HQ's pipeline entry object (has .get(field)).
  // `params` — plain object — describes what to emit for THIS step:
  //
  //   {
  //     activityType: "classify-commodity",
  //     agent: "urn:voyager:agent:hq-step:runJavaScript:commodity-classify",
  //     usedField: "id",              // entry.get("id") → used entity key
  //     generatedField: "id",         // entry.get("id") → generated entity key
  //     usedKind: "indexed-doc",      // default: "indexed-doc"
  //     generatedKind: "indexed-doc", // default: "indexed-doc" (enrichment mutates in place)
  //     extra: { rulesVersion: "v3" } // optional metadata (not part of identity)
  //   }
  //
  // Fire-and-forget: any error is written to stderr but does NOT rethrow —
  // the pipeline step should not fail because provenance emission failed.

  function emit(entry, params) {
    try {
      var activityType = params.activityType;
      if (!VALID_ACTIVITY_TYPES[activityType]) {
        throw new Error("voyagerProv: unknown activityType '" + activityType + "'");
      }
      var agent = params.agent;
      if (!agent) throw new Error("voyagerProv: params.agent is required");

      var usedField = params.usedField || "id";
      var generatedField = params.generatedField || usedField;
      var usedKind = params.usedKind || "indexed-doc";
      var generatedKind = params.generatedKind || "indexed-doc";

      var usedId = String(entry.get(usedField));
      var generatedId = String(entry.get(generatedField));
      if (!usedId || usedId === "undefined" || usedId === "null") return; // no id, no PROV

      var usedURI = ENTITY_URN_PREFIX + usedKind + ":" + usedId;
      var generatedURI = generatedKind === usedKind && generatedId === usedId
        ? ENTITY_URN_PREFIX + generatedKind + ":" + generatedId + "+enriched"
        : ENTITY_URN_PREFIX + generatedKind + ":" + generatedId;

      var startedAt = params.startedAt || Instant.now().toString();
      var endedAt = params.endedAt || Instant.now().toString();

      var typeURI = VOYAGER_ACTIVITY_NS + activityType;
      var used = [usedURI];
      var generated = [generatedURI];

      var activityId = deriveActivityId(typeURI, agent, used, generated, startedAt, endedAt);

      var jsonld = buildJsonld(activityId, typeURI, agent, used, generated, startedAt, endedAt, params.extra);
      var solrDoc = {
        id: activityId,
        prov_id: activityId,
        prov_activityType: typeURI,
        prov_agent: agent,
        prov_used: used,
        prov_generated: generated,
        prov_startedAt: startedAt,
        prov_endedAt: endedAt,
        prov_jsonld: JSON.stringify(jsonld)
      };

      writeSidecar(activityId, solrDoc);
    } catch (e) {
      java.lang.System.err.println("[voyagerProv] emit failed: " + e);
    }
  }

  // ------ Identity hash — SHA-256 slice over the canonical JSON of the identity tuple.
  function deriveActivityId(typeURI, agent, used, generated, startedAt, endedAt) {
    var sortedUsed = used.slice().sort();
    var sortedGenerated = generated.slice().sort();
    var identity = JSON.stringify([typeURI, agent, sortedUsed, sortedGenerated, startedAt, endedAt]);
    var md = MessageDigest.getInstance("SHA-256");
    var bytes = md.digest(identity.getBytes(StandardCharsets.UTF_8));
    var hex = "";
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i] & 0xff;
      hex += (b < 0x10 ? "0" : "") + b.toString(16);
    }
    return ACTIVITY_URN_PREFIX + hex.substring(0, 32);
  }

  function buildJsonld(id, typeURI, agent, used, generated, startedAt, endedAt, extra) {
    var jsonld = {
      "@context": {
        "prov": "http://www.w3.org/ns/prov#",
        "xsd": "http://www.w3.org/2001/XMLSchema#",
        "voyager": VOYAGER_URN_NS
      },
      "@id": id,
      "@type": "prov:Activity",
      "prov:type": { "@id": typeURI },
      "prov:wasAssociatedWith": { "@id": agent },
      "prov:used": used.map(function (u) { return { "@id": u }; }),
      "prov:generated": generated.map(function (g) { return { "@id": g }; }),
      "prov:startedAtTime": { "@value": startedAt, "@type": "xsd:dateTime" },
      "prov:endedAtTime": { "@value": endedAt, "@type": "xsd:dateTime" }
    };
    if (extra) jsonld["extra"] = extra;
    return jsonld;
  }

  function writeSidecar(activityId, solrDoc) {
    var slug = activityId.substring(activityId.lastIndexOf(":") + 1);
    var dir = Paths.get(HQ_PROV_ROOT_DIR);
    if (!Files.exists(dir)) Files.createDirectories(dir);
    var path = Paths.get(HQ_PROV_ROOT_DIR + "/" + slug + ".json");
    var body = JSON.stringify(solrDoc);
    Files.write(
      path,
      body.getBytes(StandardCharsets.UTF_8),
      StandardOpenOption.CREATE,
      StandardOpenOption.TRUNCATE_EXISTING,
      StandardOpenOption.WRITE
    );
  }

  // Expose on the global scope so each step's runJavaScript can call
  // `voyagerProv.emit(entry, {...})` without re-declaring the module.
  this.voyagerProv = { emit: emit };
}).call(this);
