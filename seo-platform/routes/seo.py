"""
routes/seo.py — SEO Platform plugin backend.

Provides:
  - DataForSEO proxy (keeps API credentials server-side)
  - SQLite-backed query history (free reads from cache)
  - Project management (CRUD)
  - User preferences
  - Static asset serving for JS bundle

All data stored in RUNTIME_DIR/seo-platform/ using SQLite.
"""

import base64
import json
import logging
import os
import sqlite3
import time
import threading
from datetime import datetime, timezone
from pathlib import Path

import requests as http_requests
from flask import Blueprint, jsonify, request, send_from_directory, abort

logger = logging.getLogger(__name__)

seo_platform_bp = Blueprint("seo_platform", __name__)

# ── Paths ────────────────────────────────────────────────────────────────
RUNTIME_DIR = Path(os.getenv("RUNTIME_DIR", "/app/runtime"))
PLUGIN_DATA = RUNTIME_DIR / "seo-platform"
DB_PATH = PLUGIN_DATA / "seo.db"
CONFIG_FILE = PLUGIN_DATA / "config.json"
ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"

DFSE_BASE = "https://api.dataforseo.com/v3"
DFSE_TIMEOUT = 60

# Rate limiting: 15 DataForSEO proxy calls per minute
_rate_lock = threading.Lock()
_rate_calls = []
RATE_LIMIT = 15
RATE_WINDOW = 60

# Balance cache
_balance_cache = {"value": None, "time": 0}
BALANCE_CACHE_TTL = 300  # 5 minutes


# ── Config helpers ───────────────────────────────────────────────────────

def _load_config() -> dict:
    if CONFIG_FILE.is_file():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_config(config: dict):
    PLUGIN_DATA.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(config, indent=2))


def _get_auth() -> str:
    """Get DataForSEO Basic auth header. Checks env vars first, then plugin config."""
    login = os.getenv("DATAFORSEO_LOGIN", "")
    password = os.getenv("DATAFORSEO_PASSWORD", "")
    if login and password:
        return "Basic " + base64.b64encode(f"{login}:{password}".encode()).decode()
    config = _load_config()
    login = config.get("login", "")
    password = config.get("password", "")
    if login and password:
        return "Basic " + base64.b64encode(f"{login}:{password}".encode()).decode()
    return ""


def _get_tenant() -> str:
    """Get tenant identifier."""
    t = request.args.get("tenant") or request.headers.get("X-Tenant") or ""
    if not t:
        username = os.getenv("JAMBOT_USERNAME", "") or os.getenv("CLIENT_NAME", "")
        if username:
            return username.lower().replace(" ", "-")
        import socket
        h = socket.gethostname()
        if h.startswith("openvoiceui-"):
            return h[len("openvoiceui-"):]
        return "default"
    return t


# ── Database ─────────────────────────────────────────────────────────────

def _get_db():
    PLUGIN_DATA.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_db():
    conn = _get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS seo_queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant TEXT NOT NULL,
            tool TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            query_target TEXT DEFAULT '',
            query_params TEXT DEFAULT '{}',
            result_count INTEGER DEFAULT 0,
            cost REAL DEFAULT 0,
            items TEXT DEFAULT '[]',
            summary TEXT DEFAULT '{}',
            source TEXT DEFAULT 'dashboard',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_sq_tenant_tool ON seo_queries(tenant, tool);
        CREATE INDEX IF NOT EXISTS idx_sq_target ON seo_queries(query_target);

        CREATE TABLE IF NOT EXISTS seo_projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant TEXT NOT NULL,
            domain TEXT NOT NULL,
            label TEXT DEFAULT '',
            location_name TEXT DEFAULT 'United States',
            language_name TEXT DEFAULT 'English',
            is_active INTEGER DEFAULT 1,
            competitors TEXT DEFAULT '[]',
            gmb_data TEXT DEFAULT '{}',
            brand_name TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            address TEXT DEFAULT '',
            business_category TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(tenant, domain)
        );

        CREATE TABLE IF NOT EXISTS seo_tracked_keywords (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant TEXT NOT NULL,
            domain TEXT NOT NULL,
            keyword TEXT NOT NULL,
            location_name TEXT DEFAULT 'United States',
            language_name TEXT DEFAULT 'English',
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(tenant, domain, keyword)
        );

        CREATE TABLE IF NOT EXISTS seo_preferences (
            tenant TEXT PRIMARY KEY,
            preferences TEXT DEFAULT '{}'
        );
    """)
    conn.close()


_init_db()


# ── Tool classification ──────────────────────────────────────────────────

def _tool_category(endpoint: str) -> str:
    e = endpoint.lower()
    if "search_volume" in e or "keywords_for_keywords" in e:
        return "search_volume"
    if "keyword_suggestions" in e or "keyword_ideas" in e:
        return "keyword_suggestions"
    if "keyword_difficulty" in e:
        return "keyword_difficulty"
    if "search_intent" in e:
        return "search_intent"
    if "keywords_for_site" in e:
        return "keyword_for_site"
    if "ranked_keywords" in e:
        return "ranked_keywords"
    if "bulk_traffic" in e or "traffic_estimation" in e:
        return "traffic_estimate"
    if "competitors_domain" in e or "serp_competitors" in e:
        return "competitors"
    if "domain_intersection" in e:
        return "domain_intersection"
    if "backlinks" in e and "summary" in e:
        return "backlinks_summary"
    if "backlinks" in e and "referring_domains" in e:
        return "backlinks_referring_domains"
    if "backlinks" in e and "anchors" in e:
        return "backlinks_anchors"
    if "backlinks" in e and "competitors" in e:
        return "backlinks_competitors"
    if "backlinks" in e:
        return "backlinks"
    if "on_page" in e and "lighthouse" in e:
        return "on_page_lighthouse"
    if "on_page" in e:
        return "on_page"
    if "whois" in e:
        return "whois"
    if "technologies" in e:
        return "technologies"
    if "categories_for_domain" in e:
        return "categories"
    if "content_analysis" in e and "search" in e:
        return "content_analysis_search"
    if "content_analysis" in e and "summary" in e:
        return "content_analysis_summary"
    if "content_analysis" in e and "sentiment" in e:
        return "content_analysis_sentiment"
    if "content_analysis" in e and "phrase_trends" in e:
        return "content_analysis_phrase_trends"
    if "content_analysis" in e and "rating" in e:
        return "content_analysis_rating"
    if "content_analysis" in e:
        return "content_analysis"
    if "business_data" in e and "my_business_info" in e:
        return "my_business_info"
    if "business_data" in e and "reviews" in e:
        return "google_reviews"
    if "business_data" in e and "questions_and_answers" in e:
        return "google_qna"
    if "business_data" in e:
        return "business_data"
    if "local_finder" in e:
        return "local_finder"
    if "ai_optimization" in e:
        return "ai_visibility"
    if "domain_pages" in e or "relevant_pages" in e:
        return "domain_pages"
    if "historical_rank" in e:
        return "rank_history"
    if "google_trends" in e:
        return "google_trends"
    if "serp" in e and "maps" in e:
        return "serp_maps"
    if "serp" in e and "news" in e:
        return "serp_news"
    if "serp" in e:
        return "serp_organic"
    if "domain_rank_overview" in e:
        return "domain_rank_overview"
    return "other"


def _extract_target(data: dict) -> str:
    if isinstance(data, list):
        data = data[0] if data else {}
    return str(
        data.get("keyword")
        or data.get("target")
        or (data.get("keywords", [None])[0] if isinstance(data.get("keywords"), list) else data.get("keywords"))
        or data.get("target1")
        or (data.get("targets", [None])[0] if isinstance(data.get("targets"), list) else "")
        or ""
    )


# ── Rate limiting ────────────────────────────────────────────────────────

def _check_rate_limit() -> bool:
    now = time.time()
    with _rate_lock:
        _rate_calls[:] = [t for t in _rate_calls if now - t < RATE_WINDOW]
        if len(_rate_calls) >= RATE_LIMIT:
            return False
        _rate_calls.append(now)
        return True


# ── Static assets ────────────────────────────────────────────────────────

@seo_platform_bp.route("/api/seo-platform/assets/<path:filename>")
def serve_asset(filename):
    """Serve bundled JS and other static assets."""
    if not ASSETS_DIR.is_dir():
        abort(404)
    return send_from_directory(str(ASSETS_DIR), filename)


@seo_platform_bp.route("/api/seo-platform/icon.svg")
def serve_icon():
    icon_path = Path(__file__).resolve().parent.parent / "icon.svg"
    if icon_path.is_file():
        return send_from_directory(str(icon_path.parent), "icon.svg", mimetype="image/svg+xml")
    abort(404)


# ── Config / Settings ────────────────────────────────────────────────────

@seo_platform_bp.route("/api/seo-platform/config", methods=["GET"])
def get_config():
    config = _load_config()
    safe = dict(config)
    if safe.get("password"):
        safe["password"] = "***"
    safe["has_credentials"] = bool(_get_auth())
    safe["source"] = "env" if os.getenv("DATAFORSEO_LOGIN") else ("config" if config.get("login") else "none")
    return jsonify(safe)


@seo_platform_bp.route("/api/seo-platform/config", methods=["POST"])
def save_config():
    data = request.get_json(silent=True) or {}
    login = (data.get("login") or "").strip()
    password = (data.get("password") or "").strip()
    if not login or not password:
        return jsonify({"error": "Both login (email) and password are required"}), 400

    config = _load_config()
    config["login"] = login
    config["password"] = password
    config["configured_at"] = datetime.now(timezone.utc).isoformat()
    _save_config(config)

    # Test connection
    auth = "Basic " + base64.b64encode(f"{login}:{password}".encode()).decode()
    try:
        r = http_requests.get(
            f"{DFSE_BASE}/appendix/user_data",
            headers={"Authorization": auth},
            timeout=10,
        )
        if r.status_code == 200:
            body = r.json()
            balance = body.get("money", {}).get("balance", 0)
            return jsonify({"ok": True, "balance": balance})
        else:
            return jsonify({"ok": False, "message": f"HTTP {r.status_code} — check credentials"}), 400
    except Exception as e:
        return jsonify({"ok": False, "message": str(e)}), 500


@seo_platform_bp.route("/api/seo-platform/config/test", methods=["POST"])
def test_config():
    auth = _get_auth()
    if not auth:
        return jsonify({"ok": False, "message": "No DataForSEO credentials configured"})
    try:
        r = http_requests.get(
            f"{DFSE_BASE}/appendix/user_data",
            headers={"Authorization": auth},
            timeout=10,
        )
        if r.status_code == 200:
            return jsonify({"ok": True, "balance": r.json().get("money", {}).get("balance", 0)})
        return jsonify({"ok": False, "message": f"HTTP {r.status_code}"})
    except Exception as e:
        return jsonify({"ok": False, "message": str(e)})


# ── DataForSEO Proxy ────────────────────────────────────────────────────

@seo_platform_bp.route("/api/seo-platform/proxy", methods=["POST"])
def proxy():
    auth = _get_auth()
    if not auth:
        return jsonify({"error": "DataForSEO not configured. Open SEO Settings to add your API credentials."}), 403
    if not _check_rate_limit():
        return jsonify({"error": "Rate limit exceeded — max 15 calls/min"}), 429

    tenant = _get_tenant()
    body = request.get_json(silent=True) or {}
    endpoint = body.get("endpoint", "")
    data = body.get("data", [{}])

    if not endpoint or ".." in endpoint:
        return jsonify({"error": "Invalid endpoint"}), 400

    # Forward to DataForSEO
    try:
        data_array = data if isinstance(data, list) else [data]
        r = http_requests.post(
            f"{DFSE_BASE}/{endpoint}",
            headers={"Authorization": auth, "Content-Type": "application/json"},
            json=data_array,
            timeout=DFSE_TIMEOUT,
        )
        result = r.json()
    except http_requests.Timeout:
        return jsonify({"error": "DataForSEO request timed out"}), 504
    except Exception as e:
        return jsonify({"error": f"Proxy error: {e}"}), 502

    # Auto-save to SQLite (fire and forget in background)
    if result.get("status_code") == 20000:
        try:
            _auto_save(tenant, endpoint, data_array[0] if data_array else {}, result)
        except Exception as e:
            logger.warning(f"Auto-save failed: {e}")

    return jsonify(result)


def _auto_save(tenant: str, endpoint: str, data: dict, result: dict):
    tool = _tool_category(endpoint)
    target = _extract_target(data)
    task = (result.get("tasks") or [{}])[0]
    wrapper = (task.get("result") or [{}])[0] or {}
    items = wrapper.get("items") or task.get("result") or []
    total_count = wrapper.get("total_count") or len(items) if isinstance(items, list) else 0
    cost = result.get("cost") or task.get("cost") or 0

    conn = _get_db()
    try:
        conn.execute(
            """INSERT INTO seo_queries (tenant, tool, endpoint, query_target, query_params, result_count, cost, items, summary, source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'dashboard')""",
            (tenant, tool, endpoint, target, json.dumps(data), total_count, cost, json.dumps(items)),
        )
        conn.commit()
    finally:
        conn.close()


# ── Account Balance ──────────────────────────────────────────────────────

@seo_platform_bp.route("/api/seo-platform/user", methods=["GET"])
def get_user():
    auth = _get_auth()
    if not auth:
        return jsonify({"error": "Not configured"}), 403

    now = time.time()
    if _balance_cache["value"] is not None and now - _balance_cache["time"] < BALANCE_CACHE_TTL:
        return jsonify(_balance_cache["value"])

    try:
        r = http_requests.get(
            f"{DFSE_BASE}/appendix/user_data",
            headers={"Authorization": auth},
            timeout=10,
        )
        data = r.json()
        _balance_cache["value"] = data
        _balance_cache["time"] = now
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 502


# ── Query History ────────────────────────────────────────────────────────

@seo_platform_bp.route("/api/seo-platform/history", methods=["GET"])
def history():
    tenant = _get_tenant()
    tool = request.args.get("tool", "")
    target = request.args.get("target", "")
    limit = min(int(request.args.get("limit", 50)), 200)
    offset = int(request.args.get("offset", 0))

    conn = _get_db()
    try:
        if tool and target:
            rows = conn.execute(
                """SELECT id, tool, endpoint, query_target, query_params, result_count, cost, summary, created_at
                   FROM seo_queries WHERE tenant=? AND tool LIKE ? AND query_target LIKE ?
                   ORDER BY created_at DESC LIMIT ? OFFSET ?""",
                (tenant, tool + "%", "%" + target + "%", limit, offset),
            ).fetchall()
        elif tool:
            rows = conn.execute(
                """SELECT id, tool, endpoint, query_target, query_params, result_count, cost, summary, created_at
                   FROM seo_queries WHERE tenant=? AND tool LIKE ?
                   ORDER BY created_at DESC LIMIT ? OFFSET ?""",
                (tenant, tool + "%", limit, offset),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT id, tool, endpoint, query_target, query_params, result_count, cost, summary, created_at
                   FROM seo_queries WHERE tenant=?
                   ORDER BY created_at DESC LIMIT ? OFFSET ?""",
                (tenant, limit, offset),
            ).fetchall()

        stats_row = conn.execute(
            "SELECT COUNT(*) as total_queries, COALESCE(SUM(cost),0) as total_cost FROM seo_queries WHERE tenant=?",
            (tenant,),
        ).fetchone()

        return jsonify({
            "tenant": tenant,
            "queries": [dict(r) for r in rows],
            "stats": {"total_queries": stats_row["total_queries"], "total_cost": stats_row["total_cost"]},
        })
    finally:
        conn.close()


@seo_platform_bp.route("/api/seo-platform/history/<int:query_id>", methods=["GET"])
def history_by_id(query_id):
    tenant = _get_tenant()
    conn = _get_db()
    try:
        row = conn.execute(
            "SELECT * FROM seo_queries WHERE id=? AND tenant=?", (query_id, tenant)
        ).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        result = dict(row)
        # Parse JSON fields
        for field in ("items", "summary", "query_params"):
            if isinstance(result.get(field), str):
                try:
                    result[field] = json.loads(result[field])
                except Exception:
                    pass
        return jsonify(result)
    finally:
        conn.close()


# ── Projects ─────────────────────────────────────────────────────────────

@seo_platform_bp.route("/api/seo-platform/projects", methods=["GET"])
def get_projects():
    tenant = _get_tenant()
    conn = _get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM seo_projects WHERE tenant=? AND is_active=1 ORDER BY created_at", (tenant,)
        ).fetchall()
        projects = []
        for r in rows:
            p = dict(r)
            for f in ("competitors", "gmb_data"):
                if isinstance(p.get(f), str):
                    try:
                        p[f] = json.loads(p[f])
                    except Exception:
                        pass
            projects.append(p)
        return jsonify({"tenant": tenant, "projects": projects})
    finally:
        conn.close()


@seo_platform_bp.route("/api/seo-platform/projects", methods=["POST"])
def save_project():
    tenant = _get_tenant()
    data = request.get_json(silent=True) or {}
    domain = (data.get("domain") or "").strip().lower()
    if not domain:
        return jsonify({"error": "domain is required"}), 400

    conn = _get_db()
    try:
        existing = conn.execute(
            "SELECT id FROM seo_projects WHERE tenant=? AND domain=?", (tenant, domain)
        ).fetchone()
        if existing:
            conn.execute(
                """UPDATE seo_projects SET label=?, location_name=?, language_name=?, is_active=1,
                   competitors=?, gmb_data=?, brand_name=?, phone=?, address=?, business_category=?,
                   updated_at=datetime('now') WHERE id=?""",
                (
                    data.get("label", ""),
                    data.get("location_name", "United States"),
                    data.get("language_name", "English"),
                    json.dumps(data.get("competitors", [])),
                    json.dumps(data.get("gmb_data", {})),
                    data.get("brand_name", ""),
                    data.get("phone", ""),
                    data.get("address", ""),
                    data.get("business_category", ""),
                    existing["id"],
                ),
            )
        else:
            conn.execute(
                """INSERT INTO seo_projects (tenant, domain, label, location_name, language_name, competitors,
                   gmb_data, brand_name, phone, address, business_category)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    tenant, domain,
                    data.get("label", ""),
                    data.get("location_name", "United States"),
                    data.get("language_name", "English"),
                    json.dumps(data.get("competitors", [])),
                    json.dumps(data.get("gmb_data", {})),
                    data.get("brand_name", ""),
                    data.get("phone", ""),
                    data.get("address", ""),
                    data.get("business_category", ""),
                ),
            )
        conn.commit()
        return jsonify({"ok": True, "domain": domain})
    finally:
        conn.close()


@seo_platform_bp.route("/api/seo-platform/projects/<path:domain>", methods=["DELETE"])
def delete_project(domain):
    tenant = _get_tenant()
    conn = _get_db()
    try:
        conn.execute(
            "UPDATE seo_projects SET is_active=0, updated_at=datetime('now') WHERE tenant=? AND domain=?",
            (tenant, domain),
        )
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@seo_platform_bp.route("/api/seo-platform/projects/batch", methods=["POST"])
def batch_projects():
    tenant = _get_tenant()
    data = request.get_json(silent=True) or {}
    domains = data.get("domains", [])
    added = 0
    conn = _get_db()
    try:
        for item in domains:
            d = item if isinstance(item, dict) else {"domain": item}
            domain = (d.get("domain") or "").strip().lower()
            if not domain:
                continue
            existing = conn.execute(
                "SELECT id FROM seo_projects WHERE tenant=? AND domain=?", (tenant, domain)
            ).fetchone()
            if not existing:
                conn.execute(
                    "INSERT INTO seo_projects (tenant, domain, label) VALUES (?, ?, ?)",
                    (tenant, domain, d.get("label", "")),
                )
                added += 1
        conn.commit()
        return jsonify({"ok": True, "added": added})
    finally:
        conn.close()


# ── Tracked Keywords ─────────────────────────────────────────────────────

@seo_platform_bp.route("/api/seo-platform/tracked-keywords", methods=["GET"])
def get_tracked_keywords():
    tenant = _get_tenant()
    domain = request.args.get("domain", "")
    conn = _get_db()
    try:
        if domain:
            rows = conn.execute(
                "SELECT * FROM seo_tracked_keywords WHERE tenant=? AND domain=?", (tenant, domain)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM seo_tracked_keywords WHERE tenant=?", (tenant,)
            ).fetchall()
        return jsonify({"keywords": [dict(r) for r in rows]})
    finally:
        conn.close()


@seo_platform_bp.route("/api/seo-platform/tracked-keywords", methods=["POST"])
def add_tracked_keywords():
    tenant = _get_tenant()
    data = request.get_json(silent=True) or {}
    domain = data.get("domain", "")
    keywords = data.get("keywords", [])
    added = 0
    conn = _get_db()
    try:
        for kw in keywords:
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO seo_tracked_keywords (tenant, domain, keyword) VALUES (?, ?, ?)",
                    (tenant, domain, kw),
                )
                added += 1
            except Exception:
                pass
        conn.commit()
        return jsonify({"ok": True, "added": added})
    finally:
        conn.close()


@seo_platform_bp.route("/api/seo-platform/tracked-keywords/<int:kw_id>", methods=["DELETE"])
def delete_tracked_keyword(kw_id):
    tenant = _get_tenant()
    conn = _get_db()
    try:
        conn.execute("DELETE FROM seo_tracked_keywords WHERE id=? AND tenant=?", (kw_id, tenant))
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


# ── Preferences ──────────────────────────────────────────────────────────

@seo_platform_bp.route("/api/seo-platform/preferences", methods=["GET"])
def get_preferences():
    tenant = _get_tenant()
    conn = _get_db()
    try:
        row = conn.execute("SELECT preferences FROM seo_preferences WHERE tenant=?", (tenant,)).fetchone()
        prefs = json.loads(row["preferences"]) if row else {}
        return jsonify({"preferences": prefs})
    finally:
        conn.close()


@seo_platform_bp.route("/api/seo-platform/preferences", methods=["POST"])
def save_preferences():
    tenant = _get_tenant()
    data = request.get_json(silent=True) or {}
    conn = _get_db()
    try:
        conn.execute(
            "INSERT INTO seo_preferences (tenant, preferences) VALUES (?, ?) ON CONFLICT(tenant) DO UPDATE SET preferences=?",
            (tenant, json.dumps(data), json.dumps(data)),
        )
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


# ── Dashboard aggregate ──────────────────────────────────────────────────

@seo_platform_bp.route("/api/seo-platform/dashboard", methods=["GET"])
def dashboard():
    tenant = _get_tenant()
    conn = _get_db()
    try:
        stats = conn.execute(
            """SELECT COUNT(*) as total_queries, COALESCE(SUM(cost),0) as total_cost,
               COUNT(DISTINCT tool) as tools_used, COUNT(DISTINCT query_target) as unique_targets
               FROM seo_queries WHERE tenant=?""",
            (tenant,),
        ).fetchone()
        return jsonify({"tenant": tenant, "stats": dict(stats)})
    finally:
        conn.close()


# ── Keyword tracker (accumulated) ────────────────────────────────────────

@seo_platform_bp.route("/api/seo-platform/keyword-tracker", methods=["GET"])
def keyword_tracker():
    tenant = _get_tenant()
    domain = request.args.get("domain", "")
    conn = _get_db()
    try:
        if domain:
            rows = conn.execute(
                """SELECT items FROM seo_queries WHERE tenant=? AND tool='ranked_keywords'
                   AND query_target LIKE ? ORDER BY created_at DESC LIMIT 1""",
                (tenant, "%" + domain + "%"),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT items FROM seo_queries WHERE tenant=? AND tool='ranked_keywords'
                   ORDER BY created_at DESC LIMIT 1""",
                (tenant,),
            ).fetchall()
        keywords = []
        seen = set()
        for r in rows:
            try:
                items = json.loads(r["items"]) if isinstance(r["items"], str) else r["items"]
                for item in (items or []):
                    kw = (item.get("keyword_data", {}).get("keyword") or item.get("keyword") or "").lower()
                    if kw and kw not in seen:
                        seen.add(kw)
                        keywords.append(item)
            except Exception:
                pass
        return jsonify({"keywords": keywords, "total": len(keywords)})
    finally:
        conn.close()
