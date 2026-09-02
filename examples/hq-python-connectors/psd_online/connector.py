"""FAS PSD Online Connector — Voyager HQ 3.x port (D100 pilot).

Ported from Jason's Windows source (`fas_psd_online_connector.py` in the
FAS Drive folder). Semantic behavior preserved; environment adapted for
the Linux HQ pod.

Notable changes vs upstream:
- `sys.path.append(r"E:\\...")` removed — HQ auto-adds the `py/` root.
- Base class import: `from voyager.connector import Connector` (upstream
  used `from voyager import Connector`; both resolve because
  `voyager/__init__.py` re-exports).
- Log routed to `/hq/home/py/test_data/psd_scan.log` so it's visible via
  the HQ file API.
- Config source: `utils.fas_settings` — env-driven, no on-disk secrets.
- `get_country_geo` uses HQ 3.x's `/api/search/placefinder/find?search=X`
  endpoint with a bearer token (upstream hit a Voyager Server 2.x v0
  placefinder handler, gone in 3.x). localGazetteer result is preferred
  because it carries the actual country polygon.
- Emits 3 C-chain PROV records per doc (fetch → decode → geolocate) to
  the shared sink dir. The HQ tail `runJavaScript` step in the
  `demo-fas-showcase` pipeline appends the P-chain.
"""
from voyager.connector import Connector
import logging
import datetime
import hashlib
import json
import os
import sys
import requests

from utils import common
from utils import fas_settings as cfg

# ── D100 Layer 1 / C-chain PROV emit (in-connector, no external dep) ───────
# Each PSD Online doc gets 3 activity records (fetch → decode → geolocate)
# written as individual JSON files to the prov sink. The `+enriched` HQ tail
# emitter appends the P-chain (NLP → geotag → classify → normalize). Chain
# is bridged at the indexed-doc entity URI (last C-chain generated == first
# P-chain used, per prov-emit.js e0).
PROV_SINK_DIR = "/hq/home/py/test_data/prov"
ACTIVITY_NS = "https://voyager.ogc/prov/activity/"
URN_ACTIVITY = "urn:voyager:prov:activity:"
URN_ENTITY = "urn:voyager:prov:entity:"

LOG_PATH = "/hq/home/py/test_data/psd_scan.log"
try:
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
except Exception:
    pass
logging.basicConfig(
    level=logging.INFO,
    filename=LOG_PATH,
    format=">>M=%(asctime)s.%(msecs)03d %(levelname)s %(module)s - %(funcName)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


units = {1: '(1000 BUSHES)', 2: '(1000 60 KG BAGS)', 3: '(1000 COLONIES)', 4: '(1000 HA)',
         5: '(1000 HEAD)', 6: '(1000 HL)', 7: '(1000 MT CWE)', 8: '(1000 MT)', 9: '(1000 PCS)',
         10: '(1000 TREES)', 11: '(Dec. Fraction)', 12: '(HA)', 13: '(HECTARES)', 14: '(KG)',
         15: '(MIL HEAD)', 16: '(MIL PCS)', 17: '(MILLION TREES)', 18: '(MT RAW EQ)', 19: '(MT RAW EW)',
         20: '(MT RE)', 21: '(MT)', 22: '(MT, Net Weight)', 23: '(PERCENT)', 24: '(RATIO)',
         25: '(1000 CUBIC METERS)', 26: '(MT/HA)', 27: '1000 480 lb. Bales', 28: '(Bales/HA)',
         29: '(KG/HA)', 30: 'ACRES', 31: 'BUSHELS', 32: 'HUNDREDWEIGHT', 33: 'MILLING RATE',
         34: 'BUSHELS/TON', 35: 'IMPORT MILLING RATE', 36: 'Bushels', 37: 'SHORT TONS', 38: 'MILLION LBS',
         39: 'BILLION LBS', 40: '(HEAD)', 41: '(PEOPLE)', 42: '(MONTHS)'}

attributes = {1: 'Area Planted', 4: 'Area Harvested', 5: 'Catch For Reduction', 6: 'Cows In Milk',
              7: 'Crush', 20: 'Beginning Stocks', 22: 'Sow Beginning Stocks', 23: 'Dairy Cows Beg. Stocks',
              25: 'Beef Cows Beg. Stocks', 28: 'Production', 29: 'Arabica Production',
              30: 'Beet Sugar Production', 31: 'Commercial Production', 32: 'Cows Milk Production',
              33: 'Farm Sales Weight Prod', 34: 'Filter Production', 43: 'Cane Sugar Production',
              47: 'Non-Comm. Production', 48: 'Non-Filter Production', 49: 'Other Milk Production',
              53: 'Robusta Production', 54: 'Rough Production', 56: 'Other Production', 57: 'Imports',
              58: 'Bean Imports', 62: 'Intra-EU Imports', 63: 'MY Imp. from U.S.', 64: 'Raw Imports',
              65: 'U.S. Leaf Imports', 71: 'Other Imports', 74: 'Refined Imp.(Raw Val)',
              75: 'Roast & Ground Imports', 81: 'TY Imports', 82: 'Soluble Imports', 84: 'TY Imp. from U.S.',
              86: 'Total Supply', 88: 'Exports', 89: 'Raw Exports', 90: 'Bean Exports', 94: 'Intra EU Exports',
              99: 'Refined Exp.(Raw Val)', 104: 'Other Exports', 107: 'Roast & Ground Exports',
              113: 'TY Exports', 114: 'Soluble Exports', 117: 'Total Slaughter', 118: 'Cow Slaughter',
              121: 'Sow Slaughter', 122: 'Calf Slaughter', 125: 'Domestic Consumption',
              126: 'Total Disappearance', 128: 'Dom. Leaf Consumption', 130: 'Feed Dom. Consumption',
              131: 'Fluid Use Dom. Consum.', 132: 'For Processing', 133: 'Fresh Dom. Consumption',
              135: 'Fresh Dom. Consumption', 139: 'Human Dom. Consumption', 140: 'Industrial Dom. Cons.',
              141: 'Rst,Ground Dom. Consum', 142: 'Domestic Use', 147: 'Factory Use Consum.',
              149: 'Food Use Dom. Cons.', 150: 'Loss', 151: 'Other Disappearance', 152: 'Other Use, Losses',
              154: 'Soluble Dom. Cons.', 155: 'U.S. Leaf Dom. Cons.', 158: 'Feed Use Dom. Consum.',
              161: 'Feed Waste Dom. Cons.', 167: 'Other Foreign Cons.', 169: 'Withdrawal From Market',
              172: 'Loss and Residual', 173: 'Total Disappearance', 174: 'Total Use', 175: 'Total Utilization',
              176: 'Ending Stocks', 178: 'Total Distribution', 181: 'Extr. Rate, 999.9999',
              182: 'Milling Rate (.9999)', 183: 'Seed to Lint Ratio', 184: 'Yield', 192: 'FSI Consumption',
              194: 'SME', 195: 'Stocks-to-Use'}

all_countries = {'AF': 'Afghanistan', 'AL': 'Albania', 'AG': 'Algeria', 'AO': 'Angola',
                 'AR': 'Argentina', 'AM': 'Armenia', 'AS': 'Australia', 'AU': 'Austria',
                 'AJ': 'Azerbaijan', 'BG': 'Bangladesh', 'BO': 'Belarus', 'BE': 'Belgium-Luxembourg',
                 'BL': 'Bolivia', 'BR': 'Brazil', 'BU': 'Bulgaria', 'BM': 'Burma',
                 'CA': 'Canada', 'CI': 'Chile', 'CH': 'China', 'CO': 'Colombia',
                 'CS': 'Costa Rica', 'IV': "Cote d'Ivoire", 'HR': 'Croatia', 'CU': 'Cuba',
                 'EG': 'Egypt', 'ES': 'El Salvador', 'ET': 'Ethiopia', 'E4': 'European Union',
                 'FR': 'France', 'GM': 'Germany', 'GH': 'Ghana', 'GR': 'Greece',
                 'GT': 'Guatemala', 'HO': 'Honduras', 'HK': 'Hong Kong', 'HU': 'Hungary',
                 'IN': 'India', 'ID': 'Indonesia', 'IR': 'Iran', 'IQ': 'Iraq',
                 'EI': 'Ireland', 'IT': 'Italy', 'JA': 'Japan', 'KZ': 'Kazakhstan',
                 'KE': 'Kenya', 'KN': 'Korea, North', 'KS': 'Korea, South', 'MY': 'Malaysia',
                 'MX': 'Mexico', 'MO': 'Morocco', 'NL': 'Netherlands', 'NZ': 'New Zealand',
                 'NG': 'Nigeria', 'NO': 'Norway', 'PK': 'Pakistan', 'PA': 'Paraguay',
                 'PE': 'Peru', 'RP': 'Philippines', 'PL': 'Poland', 'PO': 'Portugal',
                 'RO': 'Romania', 'RS': 'Russia', 'SA': 'Saudi Arabia', 'SF': 'South Africa',
                 'SP': 'Spain', 'CE': 'Sri Lanka', 'SU': 'Sudan', 'SW': 'Sweden',
                 'SZ': 'Switzerland', 'SY': 'Syria', 'TW': 'Taiwan', 'TH': 'Thailand',
                 'TU': 'Turkey', 'UP': 'Ukraine', 'UK': 'United Kingdom', 'US': 'United States',
                 'UY': 'Uruguay', 'UZ': 'Uzbekistan', 'VE': 'Venezuela', 'VM': 'Vietnam',
                 'YM': 'Yemen', 'ZA': 'Zambia', 'RH': 'Zimbabwe'}


def _prov_shard(slug):
    """16-way + 'z' shard, uniform via md5(slug)."""
    h = hashlib.md5(slug.encode("utf-8")).hexdigest()[0]
    return h if h in "0123456789abcdef" else "z"


def _prov_activity_id(type_uri, agent, used, generated, started_at, ended_at):
    """Deterministic 32-hex activity URN — matches JS emitter's shape."""
    identity = json.dumps(
        [type_uri, agent, sorted(used), sorted(generated), started_at, ended_at],
        separators=(",", ":"),
        sort_keys=False,
    )
    return URN_ACTIVITY + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:32]


_PROV_EMIT_ERRORS = 0
_PROV_EMIT_COUNT = 0


def _prov_emit(activity_slug, agent, used, generated, doc_id, extra=None):
    """Write one PROV activity record to the sink dir. One file = one Solr doc."""
    global _PROV_EMIT_ERRORS, _PROV_EMIT_COUNT
    try:
        _prov_emit_inner(activity_slug, agent, used, generated, doc_id, extra)
        _PROV_EMIT_COUNT += 1
    except Exception as e:
        _PROV_EMIT_ERRORS += 1
        import traceback
        sys.stderr.write("[psd_online prov-emit err] doc_id=%s activity=%s exc=%r\n" % (doc_id, activity_slug, e))
        traceback.print_exc(file=sys.stderr)


def _prov_emit_inner(activity_slug, agent, used, generated, doc_id, extra=None):
    type_uri = ACTIVITY_NS + activity_slug
    started = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    ended = started
    act_id = _prov_activity_id(type_uri, agent, used, generated, started, ended)
    jsonld = {
        "@context": {
            "prov": "http://www.w3.org/ns/prov#",
            "xsd": "http://www.w3.org/2001/XMLSchema#",
            "voyager": "urn:voyager:prov:",
        },
        "@id": act_id,
        "@type": "prov:Activity",
        "prov:type": {"@id": type_uri},
        "prov:wasAssociatedWith": {"@id": agent},
        "prov:used": [{"@id": u} for u in used],
        "prov:generated": [{"@id": g} for g in generated],
        "prov:startedAtTime": {"@value": started, "@type": "xsd:dateTime"},
        "prov:endedAtTime":   {"@value": ended,   "@type": "xsd:dateTime"},
    }
    if extra:
        jsonld["extra"] = extra
    rec = {
        "id": act_id,
        "prov_id": act_id,
        "prov_activityType": type_uri,
        "prov_agent": agent,
        "prov_used": list(used),
        "prov_generated": list(generated),
        "prov_startedAt": started,
        "prov_endedAt": ended,
        "prov_jsonld": json.dumps(jsonld, separators=(",", ":")),
    }
    short = activity_slug.replace("fas-source-", "").replace("fas-", "")[:8]
    fname = "%s-%s.json" % (doc_id, short)
    shard = _prov_shard(doc_id)
    dpath = os.path.join(PROV_SINK_DIR, shard)
    try:
        os.makedirs(dpath, exist_ok=True)
    except Exception:
        pass
    with open(os.path.join(dpath, fname), "w") as f:
        json.dump(rec, f)


class FASPSDOnlineConnector(Connector):

    AGENT_FETCH  = "urn:voyager:agent:hq-connector:py/psd_online:fetch@demo-fas-showcase"
    AGENT_DECODE = "urn:voyager:agent:hq-connector:py/psd_online:decode@demo-fas-showcase"
    AGENT_GEO    = "urn:voyager:agent:hq-connector:py/psd_online:geolocate@demo-fas-showcase"

    def __init__(self):
        super(FASPSDOnlineConnector, self).__init__()
        self.utils = common.CommonUtils()
        self.API_KEY = cfg.PSD_ONLINE_API_KEY
        self.months = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December']
        # geo_cache stores both hits AND misses. On a miss we set None so we
        # don't re-hit the placefinder for every doc of the same country.
        self.geo_cache = {}
        self.repo = None
        self.repo_id = None
        self.total_indexed = 0
        self.prov_written = 0

    def describe(self):
        return {
            "name": "psd_online",
            "category": "web",
            "title": "FAS PSD Online",
            "description": "USDA FAS PSD Online commodity data — country x commodity x year x attribute rows.",
            "params": [
                {"name": "minyear", "title": "Year",
                 "description": "Market year to index (only single-year pulls in this port).",
                 "type": "integer", "required": True, "default": 2026}
            ]
        }

    def list(self, repo):
        return {"datasets": []}

    def info(self, repo, dataset):
        return {}

    def get_country_geo(self, country):
        """HQ 3.x placefinder: POST /api/search/placefinder/find?search=<name>.
        Returns the localGazetteer polygon when available; None otherwise.
        Cache hits AND misses so we call the endpoint at most once per country
        per scan."""
        if country in self.geo_cache:
            return self.geo_cache[country]
        try:
            url = "%s/api/search/placefinder/find?%s" % (
                cfg.HQ_BASE_URL,
                requests.compat.urlencode({"search": country}),
            )
            resp = requests.post(
                url,
                headers={"Cookie": "vg-token=%s" % cfg.HQ_API_TOKEN},
                timeout=10,
                verify=False,
            ).json()
            for result in resp.get("results", []):
                if result.get("finder") == "localGazetteer" and result.get("geo"):
                    try:
                        geo = json.loads(result["geo"])
                        self.geo_cache[country] = geo
                        return geo
                    except Exception:
                        continue
        except Exception as e:
            logging.info("placefinder error for %s: %s" % (country, e))
        # Cache the failure so we don't retry for every row of the same country.
        self.geo_cache[country] = None
        return None

    def get_commodities(self):
        r = requests.get(
            "https://api.fas.usda.gov/api/psd/commodities",
            headers={"X-API-KEY": self.API_KEY}, timeout=30
        )
        return r.json()

    def get_commodity_data_for_year(self, code, year):
        headers = {"X-API-KEY": self.API_KEY}
        url = "https://api.fas.usda.gov/api/psd/commodity/%s/country/all/year/%s" % (code, year)
        r = requests.get(url, headers=headers, timeout=60)
        if r.status_code == 200:
            return r.json()
        return None

    def create_entry(self, entry, country, commodity_name):
        cm = country['month']
        month_ix = int(cm[1] if cm.startswith('0') else cm)
        entry['fields']['format_type'] = 'PSD Online'
        entry['fields']['format'] = 'text/plain'
        entry['fields']['fs_commodity_code'] = country['commodityCode'].strip()
        entry['fields']['fi_release_year'] = country['marketYear'].strip() if isinstance(country['marketYear'], str) else country['marketYear']
        entry['fields']['fi_release_month'] = int(cm) if isinstance(cm, str) else cm
        entry['fields']['fs_release_month'] = self.months[month_ix - 1]
        entry['fields']['fu_value'] = country['value']
        unit_desc = units.get(country['unitId'], '')
        attr_desc = attributes.get(country['attributeId'], '')
        country_name = all_countries.get(country['countryCode'], country['countryCode'])
        entry['fields']['description'] = "%s %s %s" % (country['value'], unit_desc, attr_desc)
        entry['fields']['fs_country_code'] = country['countryCode'].strip()
        entry['fields']['fss_commodity_type'] = commodity_name
        entry['fields']['fs_commodity_description'] = commodity_name
        entry['fields']['fs_country'] = country_name
        entry['fields']['fs_attribute_description'] = attr_desc
        entry['fields']['fi_attribute_id'] = country['attributeId']
        entry['fields']['fs_unit_description'] = unit_desc
        entry['fields']['name'] = "%s %s, %s: %s" % (
            country_name, entry['fields']['fs_release_month'], entry['fields']['fi_release_year'], commodity_name
        )
        geo = self.get_country_geo(entry['fields']['fs_country'])
        if geo:
            entry['spatial'] = {'shape': geo}

    @staticmethod
    def create_id(country):
        return '%s_%s_%s_%s' % (
            country['countryCode'].strip(),
            country['commodityCode'].strip(),
            country['marketYear'].strip() if isinstance(country['marketYear'], str) else country['marketYear'],
            country['attributeId']
        )

    def scan(self, repo, *datasets):
        self.repo = repo
        self.repo_id = repo.get('id') if isinstance(repo, dict) else None
        if not isinstance(repo, dict) or 'config' not in repo:
            raise Exception("config not set in params.")

        target_year = repo['config'].get('minyear', datetime.datetime.now().year)
        logging.info("scanning year %s" % target_year)
        sys.stderr.write("[psd_online] scan start year=%s repo=%s\n" % (target_year, self.repo_id))
        sys.stderr.flush()

        commodities_obj = self.get_commodities()
        if not commodities_obj:
            raise Exception("could not fetch commodities list from FAS API")
        commodities = {c['commodityCode']: c['commodityName'].strip() for c in commodities_obj}

        commodity_count = 0
        for comm, comm_name in commodities.items():
            commodity_count += 1
            msg = "[psd_online] commodity %d/%d: %s (%s) indexed=%d prov_ok=%d prov_err=%d geo_cached=%d" % (
                commodity_count, len(commodities), comm, comm_name,
                self.total_indexed, _PROV_EMIT_COUNT, _PROV_EMIT_ERRORS, len(self.geo_cache))
            sys.stderr.write(msg + "\n")
            sys.stderr.flush()
            logging.info(msg)
            try:
                market_data = self.get_commodity_data_for_year(comm, target_year)
            except Exception as e:
                logging.error("commodity %s FAS API err: %r" % (comm, e))
                continue
            if not market_data:
                logging.info("commodity %s returned no data" % comm)
                continue
            for country in market_data:
                if 'calendarYear' not in country or 'month' not in country:
                    continue
                if country['countryCode'] not in all_countries:
                    continue
                doc_id = self.create_id(country)
                job = {
                    'id': doc_id,
                    'entry': {'fields': {'repository': self.repo_id}}
                }
                # ── C-chain step 1: fas-source-fetch ────────────────────────
                # `prov_used` is a per-doc URI, NOT a shared batch URI.
                # Earlier revisions used `fas-catalog:psd-online:{comm}:{year}`
                # which was the same URI for every doc of that commodity+year
                # (~82 countries), causing the graph walk in mastra's sink to
                # fan out to hundreds of activities from a single hop. The
                # batch identity (commodity+year+country) lives in `extra`
                # instead, so anyone reasoning about "same API call" can still
                # get there without turning it into a chain-walkable hub URI.
                e_ext = URN_ENTITY + "fas-catalog-item:psd-online:%s" % doc_id
                e_raw = URN_ENTITY + "fas-source-raw:psd-online:%s" % doc_id
                _prov_emit(
                    "fas-source-fetch", self.AGENT_FETCH,
                    [e_ext], [e_raw], doc_id,
                    extra={
                        "commodity": comm,
                        "year": target_year,
                        "country": country.get("countryCode"),
                        "batch_catalog_uri": URN_ENTITY + "fas-catalog:psd-online:%s:%s" % (comm, target_year),
                    },
                )
                # ── C-chain step 2: fas-code-decode ────────────────────────
                e_dec = URN_ENTITY + "fas-source-decoded:psd-online:%s" % doc_id
                self.create_entry(job['entry'], country, comm_name)
                _prov_emit(
                    "fas-code-decode", self.AGENT_DECODE,
                    [e_raw], [e_dec], doc_id,
                    extra={"unitId": country.get("unitId"), "attributeId": country.get("attributeId")},
                )
                # ── C-chain step 3: fas-geolocate ──────────────────────────
                e_doc = URN_ENTITY + "indexed-doc:%s" % doc_id
                _prov_emit(
                    "fas-geolocate", self.AGENT_GEO,
                    [e_dec], [e_doc], doc_id,
                    extra={"country_name": job['entry']['fields'].get('fs_country'),
                           "has_shape": bool(job['entry'].get('spatial'))},
                )
                self.prov_written += 3
                job['entry']['fields']['id'] = doc_id
                job['entry']['fields']['repository'] = self.repo_id
                self.index(job)
                self.total_indexed += 1

        sys.stderr.write("[psd_online] INDEX COMPLETE — commodities=%d indexed=%d prov_ok=%d prov_err=%d geo_cache=%d year=%s\n" % (
            commodity_count, self.total_indexed, _PROV_EMIT_COUNT, _PROV_EMIT_ERRORS, len(self.geo_cache), target_year))
        sys.stderr.flush()
        logging.info("INDEX COMPLETE — total indexed=%s prov_records=%s year=%s geo_hits=%s" % (
            self.total_indexed, self.prov_written, target_year,
            sum(1 for v in self.geo_cache.values() if v)))


if __name__ == "__main__":
    Connector.main(FASPSDOnlineConnector())
