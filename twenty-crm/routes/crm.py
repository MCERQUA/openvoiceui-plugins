"""
routes/crm.py — Twenty CRM plugin API.

Endpoints:
  GET  /api/crm/config          — get saved CRM configuration
  POST /api/crm/config          — save CRM configuration (url, subdomain, api_key)
  GET  /api/crm/status          — connection status + quick health check
  POST /api/crm/test-connection — test API key against the CRM instance
"""

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import requests as http_requests
from flask import Blueprint, jsonify, request

logger = logging.getLogger(__name__)

twenty_crm_bp = Blueprint("twenty_crm", __name__)

# Config lives on the server volume — never in localStorage
RUNTIME_DIR = Path(os.getenv("RUNTIME_DIR", "/app/runtime"))
CONFIG_FILE = RUNTIME_DIR / "crm-config.json"

# Timeout for outbound requests to the CRM server
CRM_REQUEST_TIMEOUT = 10


def _load_config() -> dict:
    """Load CRM config from disk. Returns empty dict if not configured."""
    if CONFIG_FILE.is_file():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except Exception as e:
            logger.warning(f"Failed to read CRM config: {e}")
    return {}


def _save_config(config: dict) -> None:
    """Persist CRM config to disk."""
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(config, indent=2))
    logger.info("CRM config saved")


def _get_username() -> str:
    """Derive the current username from environment."""
    username = os.getenv("JAMBOT_USERNAME", "")
    if username:
        return username
    client_name = os.getenv("CLIENT_NAME", "")
    if client_name:
        return client_name.lower().replace(" ", "-")
    import socket
    hostname = socket.gethostname()
    if hostname.startswith("openvoiceui-"):
        return hostname[len("openvoiceui-"):]
    return ""


def _test_crm_connection(crm_url: str, api_key: str) -> dict:
    """
    Test the CRM connection by hitting /rest/people?limit=1.
    Returns {ok, status_code, message, latency_ms}.
    """
    url = crm_url.rstrip("/") + "/rest/people?limit=1"
    start = time.monotonic()
    try:
        resp = http_requests.get(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=CRM_REQUEST_TIMEOUT,
        )
        latency_ms = int((time.monotonic() - start) * 1000)

        if resp.status_code == 200:
            return {
                "ok": True,
                "status_code": 200,
                "message": "Connected successfully",
                "latency_ms": latency_ms,
            }
        elif resp.status_code == 401:
            return {
                "ok": False,
                "status_code": 401,
                "message": "API key is invalid or expired. Generate a new key in Twenty CRM Settings.",
                "latency_ms": latency_ms,
            }
        elif resp.status_code == 403:
            return {
                "ok": False,
                "status_code": 403,
                "message": "Access denied. The API key may not have permission for this workspace.",
                "latency_ms": latency_ms,
            }
        else:
            return {
                "ok": False,
                "status_code": resp.status_code,
                "message": f"Unexpected response: HTTP {resp.status_code}",
                "latency_ms": latency_ms,
            }
    except http_requests.ConnectionError:
        return {
            "ok": False,
            "status_code": 0,
            "message": f"Cannot reach {crm_url}. Check the URL and ensure the CRM server is running.",
            "latency_ms": 0,
        }
    except http_requests.Timeout:
        return {
            "ok": False,
            "status_code": 0,
            "message": f"Connection timed out after {CRM_REQUEST_TIMEOUT}s. The CRM server may be overloaded.",
            "latency_ms": CRM_REQUEST_TIMEOUT * 1000,
        }
    except Exception as e:
        return {
            "ok": False,
            "status_code": 0,
            "message": f"Connection error: {str(e)}",
            "latency_ms": 0,
        }


# ── Endpoints ─────────────────────────────────────────────────────────


@twenty_crm_bp.route("/api/crm/config", methods=["GET"])
def get_config():
    """Return the saved CRM configuration (API key is masked)."""
    config = _load_config()
    username = _get_username()

    # Mask the API key for display (show first 12 chars + ...)
    safe_config = dict(config)
    if safe_config.get("api_key"):
        key = safe_config["api_key"]
        safe_config["api_key_preview"] = key[:12] + "..." if len(key) > 12 else "***"
        safe_config["api_key_set"] = True
        del safe_config["api_key"]
    else:
        safe_config["api_key_set"] = False
        safe_config["api_key_preview"] = ""

    safe_config["username"] = username
    safe_config["configured"] = bool(
        config.get("crm_url") and config.get("api_key")
    )
    return jsonify(safe_config)


@twenty_crm_bp.route("/api/crm/config", methods=["POST"])
def save_config():
    """Save CRM configuration. Expects JSON: {crm_url, subdomain?, api_key}."""
    data = request.get_json(silent=True) or {}

    crm_url = (data.get("crm_url") or "").strip().rstrip("/")
    subdomain = (data.get("subdomain") or "").strip()
    api_key = (data.get("api_key") or "").strip()

    if not crm_url:
        return jsonify({"error": "CRM server URL is required"}), 400
    if not api_key:
        return jsonify({"error": "API key is required"}), 400

    # Basic URL validation
    if not crm_url.startswith("http"):
        return jsonify({"error": "CRM URL must start with https:// or http://"}), 400

    config = _load_config()
    config["crm_url"] = crm_url
    config["api_key"] = api_key
    config["configured_at"] = datetime.now(timezone.utc).isoformat()

    if subdomain:
        config["subdomain"] = subdomain
    elif not config.get("subdomain"):
        # Auto-detect from username
        username = _get_username()
        if username:
            config["subdomain"] = username

    _save_config(config)

    # Test the connection immediately
    test_result = _test_crm_connection(crm_url, api_key)
    config["last_test"] = test_result
    config["last_test_at"] = datetime.now(timezone.utc).isoformat()
    _save_config(config)

    return jsonify({
        "ok": True,
        "connection": test_result,
    })


@twenty_crm_bp.route("/api/crm/status", methods=["GET"])
def get_status():
    """Quick status check: is CRM configured and reachable?"""
    config = _load_config()
    username = _get_username()

    result = {
        "configured": bool(config.get("crm_url") and config.get("api_key")),
        "crm_url": config.get("crm_url", ""),
        "subdomain": config.get("subdomain", username),
        "username": username,
        "configured_at": config.get("configured_at"),
    }

    # If configured, run a live connection test
    if result["configured"]:
        test = _test_crm_connection(config["crm_url"], config["api_key"])
        result["connection"] = test

        # Update cached test result
        config["last_test"] = test
        config["last_test_at"] = datetime.now(timezone.utc).isoformat()
        _save_config(config)
    else:
        result["connection"] = {"ok": False, "message": "Not configured"}

    return jsonify(result)


@twenty_crm_bp.route("/api/crm/test-connection", methods=["POST"])
def test_connection():
    """
    Test a CRM connection with provided credentials (before saving).
    Expects JSON: {crm_url, api_key}.
    """
    data = request.get_json(silent=True) or {}
    crm_url = (data.get("crm_url") or "").strip().rstrip("/")
    api_key = (data.get("api_key") or "").strip()

    if not crm_url or not api_key:
        return jsonify({
            "ok": False,
            "message": "Both CRM URL and API key are required",
        }), 400

    result = _test_crm_connection(crm_url, api_key)
    return jsonify(result)


@twenty_crm_bp.route("/api/crm/iframe-url", methods=["GET"])
def get_iframe_url():
    """
    Return the URL to embed in the CRM iframe.
    Uses subdomain + crm_url to build the workspace-specific URL.
    """
    config = _load_config()
    username = _get_username()

    crm_url = config.get("crm_url", "")
    subdomain = config.get("subdomain") or username

    if not crm_url:
        return jsonify({"error": "CRM not configured", "url": ""}), 404

    # Build workspace URL: https://<subdomain>.crm.example.com
    # from base URL: https://crm.example.com
    # Strategy: insert subdomain before the CRM hostname
    try:
        from urllib.parse import urlparse, urlunparse
        parsed = urlparse(crm_url)
        workspace_host = f"{subdomain}.{parsed.hostname}"
        if parsed.port:
            workspace_host += f":{parsed.port}"
        workspace_url = urlunparse((
            parsed.scheme, workspace_host, parsed.path, "", "", ""
        ))
    except Exception:
        workspace_url = crm_url

    return jsonify({
        "url": workspace_url,
        "subdomain": subdomain,
        "base_url": crm_url,
    })
