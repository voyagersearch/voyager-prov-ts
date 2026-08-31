"""utils.fas_settings — env-driven config for the D100 FAS pilot.

Upstream (`FAS Connectors/utils/fas_settings.py`) is a flat Python file
of hard-coded absolute Windows paths, secrets, and shared endpoints.
For the demo HQ pod we make everything env-driven so nothing that could
rotate stays inside the port; unset knobs fall through to safe defaults.
"""
import os

# ── HQ REST base (reachable from the Python subprocess) ──────────────────
# We use the public URL because the subprocess isn't given the pod-internal
# HQ port. Cheap (few round-trips per scan, once per unique country).
HQ_BASE_URL = os.environ.get("HQ_BASE_URL", "https://hq.demo.voyagersearch.com")

# ── HQ API token for the placefinder call in get_country_geo ─────────────
# Created via /api/tokens for user 'admin', name 'psd-online-connector'.
# Long-lived (2027-01-01). Rotate by re-issuing and updating this value.
HQ_API_TOKEN = os.environ.get(
    "HQ_API_TOKEN",
    "eyJ6aXAiOiJERUYiLCJhbGciOiJIUzUxMiJ9.eJwVjbEKwjAURf_lzQ6maUjTydAW7GCFGqciJZoMD2oCSZzEf_d1vOce7v0C5gwtYCg-BbvBAfLnSUC7NwbMJdkSE1G0BVomm4bVFVcVaT5njIFUZo9CKKlq8VoZY0KqdelOXEjpXMX3RXSk2X2RUoqbp8sF9N2ch8mMnTZDT4XuL-M03syszXWGx-8PXMYtdQ.I8T91KdTYNk5bDrQhI3zIToOx8_mPWKgqVrlkHAKrL4rm6dQSfFeZpUBnmEab1K2sb8HFPaGeomOQb4QdNgrMQ",
)

# ── Legacy alias (upstream code path) ────────────────────────────────────
# Kept so existing utils.common:query_solr callers still resolve; the PSD
# Online port no longer uses it (placefinder now hits HQ's /api/search).
VOYAGER_SERVER_V0_URL = os.environ.get(
    "VOYAGER_SERVER_V0_URL",
    "http://localhost:8983/solr/main",
)

# ── FAS API keys ─────────────────────────────────────────────────────────
PSD_ONLINE_API_KEY = os.environ.get(
    "PSD_ONLINE_API_KEY",
    "XRnlihOr6aH5q4Sg3QYtbljMEObZd0RGT2VpEW39",
)

# Reserved for future connector ports:
FAS_GAIN_API_KEY = os.environ.get("FAS_GAIN_API_KEY", "")
FAS_CIR_API_KEY = os.environ.get("FAS_CIR_API_KEY", "")
FAS_WAP_API_KEY = os.environ.get("FAS_WAP_API_KEY", "")

# ── OCR / vision (declared but unused by the PSD Online port) ────────────
GOOGLE_CLOUD_VISION_JSON = os.environ.get("GOOGLE_CLOUD_VISION_JSON", "")
