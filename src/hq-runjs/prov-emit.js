// voyager-prov — HQ tail-of-pipeline Layer 1 emitter (D100).
//
// The canonical Nashorn-safe version of the runJavaScript step that goes
// into HQ pipelines (e.g. `demo-fas-showcase`). The demo instance's inline
// pipeline copy is kept byte-parity with this file — bump this + the inline
// together.
//
// v3 (2026-08):
// - Chains used→generated per activity so the graph reflects HQ's actual
//   sequential PRE_INDEX order. Each Layer 1 step consumes the entity the
//   previous step produced.
// - Terminal step names its output `<id>+enriched`. Mastra's chunker uses
//   that as its `used` — the bridge is a stable name, not a step name.
// - Reads a D110 register remap file from HQ_PROV_REGISTER_MAP (default
//   `/hq/home/py/test_data/prov-register-map.json`) at pipeline load via
//   `java.nio.file.Files`. Missing/malformed → falls back to internal
//   namespace. Same contract as voyager-prov-{ts,py}'s DEFAULT_REMAP.
// - Fire-and-forget HTTPS POST to mastra's /prov/emit shim (durability).

var VOYAGER_ACTIVITY_NS = "https://voyager.ogc/prov/activity/";
var VOYAGER_URN_NS = "urn:voyager:prov:";
var ACTIVITY_URN_PREFIX = VOYAGER_URN_NS + "activity:";
var ENTITY_URN_PREFIX = VOYAGER_URN_NS + "entity:";
var PROV_EMIT_URL = "https://fas-chat.demo.voyagersearch.com/prov/emit";
var REGISTER_MAP_PATH = "/hq/home/py/test_data/prov-register-map.json";

var Files = java.nio.file.Files;
var Paths = java.nio.file.Paths;
var StandardCharsets = java.nio.charset.StandardCharsets;
var MessageDigest = java.security.MessageDigest;
var Instant = java.time.Instant;
var URI = java.net.URI;
var HttpClient = java.net.http.HttpClient;
var HttpRequest = java.net.http.HttpRequest;
var HttpResponse = java.net.http.HttpResponse;
var Duration = java.time.Duration;

// ── D110 register remap, loaded once via Java NIO ──────────────────────────
if (typeof this._voyagerProvRemap === "undefined") {
  var _loaded = null;
  try {
    var _p = Paths.get(REGISTER_MAP_PATH);
    if (Files.exists(_p)) {
      var _bytes = Files.readAllBytes(_p);
      var _text = new java.lang.String(_bytes, StandardCharsets.UTF_8);
      _loaded = JSON.parse(_text);
      if (!_loaded || typeof _loaded !== "object" || Array.isArray(_loaded)) _loaded = null;
    }
  } catch (e) {
    java.lang.System.err.println("[voyagerProv] register load failed: " + e);
    _loaded = null;
  }
  this._voyagerProvRemap = _loaded || {};
}
var REMAP = this._voyagerProvRemap;

function _activityTypeURI(slug) {
  return (REMAP && REMAP[slug]) ? REMAP[slug] : (VOYAGER_ACTIVITY_NS + slug);
}

// ── Shared HttpClient ──────────────────────────────────────────────────────
if (!this._voyagerProvClient) {
  this._voyagerProvClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
}
var httpClient = this._voyagerProvClient;

function _deriveActivityId(typeURI, agent, used, generated, startedAt, endedAt) {
  var sortedUsed = used.slice().sort();
  var sortedGenerated = generated.slice().sort();
  var identity = JSON.stringify([typeURI, agent, sortedUsed, sortedGenerated, startedAt, endedAt]);
  var md = MessageDigest.getInstance("SHA-256");
  var bytes = md.digest(identity.getBytes(StandardCharsets.UTF_8));
  var hex = "";
  for (var i = 0; i < bytes.length; i++) { var b = bytes[i] & 0xff; hex += (b < 0x10 ? "0" : "") + b.toString(16); }
  return ACTIVITY_URN_PREFIX + hex.substring(0, 32);
}

/**
 * Build one SolrProvDoc for one activity in the enrichment chain. `usedURI`
 * and `generatedURI` are wired by the caller so activity N's `usedURI`
 * equals activity (N-1)'s `generatedURI` — a proper causal chain, not a fan.
 */
function _buildRecord(activityType, agent, usedURI, generatedURI, extra) {
  var typeURI = _activityTypeURI(activityType);
  var used = [usedURI];
  var generated = [generatedURI];
  var startedAt = Instant.now().toString();
  var endedAt = startedAt;
  var activityId = _deriveActivityId(typeURI, agent, used, generated, startedAt, endedAt);
  var jsonld = {
    "@context": { "prov": "http://www.w3.org/ns/prov#", "xsd": "http://www.w3.org/2001/XMLSchema#", "voyager": VOYAGER_URN_NS },
    "@id": activityId,
    "@type": "prov:Activity",
    "prov:type": { "@id": typeURI },
    "prov:wasAssociatedWith": { "@id": agent },
    "prov:used": [{ "@id": usedURI }],
    "prov:generated": [{ "@id": generatedURI }],
    "prov:startedAtTime": { "@value": startedAt, "@type": "xsd:dateTime" },
    "prov:endedAtTime": { "@value": endedAt, "@type": "xsd:dateTime" }
  };
  if (extra) jsonld.extra = extra;
  return {
    id: activityId, prov_id: activityId,
    prov_activityType: typeURI, prov_agent: agent,
    prov_used: used, prov_generated: generated,
    prov_startedAt: startedAt, prov_endedAt: endedAt,
    prov_jsonld: JSON.stringify(jsonld)
  };
}

var _docId = entry.get("id");
if (_docId) {
  _docId = String(_docId);
  var baseEntity = ENTITY_URN_PREFIX + "indexed-doc:";
  // One entity URI per pipeline step, wired sequentially. Terminal step
  // outputs `+enriched` — mastra's chunker.used points here.
  var e0 = baseEntity + _docId;                       // raw indexed doc
  var e1 = baseEntity + _docId + "+geotag";
  var e2 = baseEntity + _docId + "+nlp";
  var e3 = baseEntity + _docId + "+commodity";
  var e4 = baseEntity + _docId + "+region";
  var e5 = baseEntity + _docId + "+normalize";
  var e6 = baseEntity + _docId + "+enriched";         // terminal: grp-tagger
  var records = [
    _buildRecord("geotag",              "urn:voyager:agent:hq-step:nlpGeoTag@demo-fas-showcase",                        e0, e1),
    _buildRecord("nlp-extract-entities","urn:voyager:agent:hq-step:extractNamedEntities@demo-fas-showcase",             e1, e2),
    _buildRecord("classify-commodity",  "urn:voyager:agent:hq-step:runJavaScript:commodity-classify@demo-fas-showcase", e2, e3),
    _buildRecord("classify-region",     "urn:voyager:agent:hq-step:runJavaScript:region-classify@demo-fas-showcase",    e3, e4),
    _buildRecord("field-normalize",     "urn:voyager:agent:hq-step:concatenateFields@demo-fas-showcase",                e4, e5),
    _buildRecord("classify-region",     "urn:voyager:agent:hq-step:runJavaScript:grp-tagger@demo-fas-showcase",         e5, e6, { pass: "grp-tagger-v3", terminal: true })
  ];
  try {
    var body = JSON.stringify({ records: records });
    var req = HttpRequest.newBuilder()
      .uri(URI.create(PROV_EMIT_URL))
      .timeout(Duration.ofSeconds(5))
      .header("Content-Type", "application/json")
      .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
      .build();
    httpClient.sendAsync(req, HttpResponse.BodyHandlers.discarding());
  } catch (e) {
    java.lang.System.err.println("[voyagerProv] POST /prov/emit failed: " + e);
  }
}
