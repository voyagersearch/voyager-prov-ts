"""utils.common — STRIPPED port for D100 pilot.

Upstream (`FAS Connectors/utils/common.py`) is a ~500-line utility mixin
covering PDF text extraction, Google Vision OCR, docx parsing,
placefinder lookups, HTTP session with retries, etc. The PSD Online
connector's only touchpoint into this module is `CommonUtils().query_solr(query)`,
so this port ships just that one method.

If we later port CIR / WAP / Photo Gallery, add fetch / OCR / PDF helpers
here — but only what the connectors that get deployed actually use.
"""
import logging

try:
    import requests
except Exception:  # pragma: no cover
    requests = None

try:
    from . import fas_settings as cfg
except ImportError:
    from utils import fas_settings as cfg


class CommonUtils(object):
    """Slim subset of the upstream CommonUtils for the PSD Online port."""

    def query_solr(self, query):
        if requests is None:
            raise RuntimeError("requests not installed in the connector's Python env")
        url = "%s/select?%s&wt=json" % (cfg.VOYAGER_SERVER_V0_URL, query)
        logging.info("retrieving %s" % url)
        try:
            return requests.get(url, verify=False, timeout=30).json()
        except Exception as e:
            logging.error("query_solr failed: %s" % e)
            return {}
