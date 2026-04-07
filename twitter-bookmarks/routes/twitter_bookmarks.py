"""
routes/twitter_bookmarks.py — Twitter Bookmarks plugin API.

Endpoints:
  GET  /api/twitter/config             — get saved config (cookies masked)
  POST /api/twitter/config             — save X session cookies (ct0, auth_token)
  GET  /api/twitter/status             — connection status + test
  GET  /api/twitter/bookmarks          — fetch recent bookmarks (live from X)
  GET  /api/twitter/permissions        — get permission states
  POST /api/twitter/permissions        — update permissions
  GET  /api/twitter/library            — get stored bookmark library (search, filter, paginate)
  POST /api/twitter/library/sync       — sync new bookmarks from X into library
  GET  /api/twitter/library/<id>       — get single bookmark + research
  POST /api/twitter/library/<id>/tags  — update tags for a bookmark
  POST /api/twitter/library/<id>/research — save research results for a bookmark
  GET  /api/twitter/schedule           — get sync schedule config
  POST /api/twitter/schedule           — update sync schedule config
  GET  /api/twitter/tags               — get all tags with counts
"""

import json
import logging
import os
import re
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, jsonify, request

logger = logging.getLogger(__name__)

twitter_bookmarks_bp = Blueprint("twitter_bookmarks", __name__)

# Config lives in the plugin's own directory (persistent volume mount)
PLUGIN_DIR = Path("/app/plugins/twitter-bookmarks")
CONFIG_FILE = PLUGIN_DIR / "config.json"

# X's internal public bearer token (same one x.com frontend uses)
BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"

FEATURES = {
    "graphql_timeline_v2_bookmark_timeline": True,
    "rweb_tipjar_consumption_enabled": True,
    "responsive_web_graphql_exclude_directive_enabled": True,
    "verified_phone_label_enabled": False,
    "creator_subscriptions_tweet_preview_api_enabled": True,
    "responsive_web_graphql_timeline_navigation_enabled": True,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
    "communities_web_enable_tweet_community_results_fetch": True,
    "c9s_tweet_anatomy_moderator_badge_enabled": True,
    "articles_preview_enabled": True,
    "responsive_web_edit_tweet_api_enabled": True,
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
    "view_counts_everywhere_api_enabled": True,
    "longform_notetweets_consumption_enabled": True,
    "responsive_web_twitter_article_tweet_consumption_enabled": True,
    "tweet_awards_web_tipping_enabled": False,
    "creator_subscriptions_quote_tweet_preview_enabled": False,
    "freedom_of_speech_not_reach_fetch_enabled": True,
    "standardized_nudges_misinfo": True,
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
    "rweb_video_timestamps_enabled": True,
    "longform_notetweets_rich_text_read_enabled": True,
    "longform_notetweets_inline_media_enabled": True,
    "responsive_web_enhance_cards_enabled": False,
}

REQUEST_TIMEOUT = 30

# ── Library and research storage ────────────────────────────────────
LIBRARY_FILE = PLUGIN_DIR / "library.json"
RESEARCH_DIR = PLUGIN_DIR / "research"
SCHEDULE_FILE = PLUGIN_DIR / "schedule.json"


def _load_library() -> dict:
    """Load bookmark library. Structure: {bookmarks: {id: {...}}, synced_ids: [...]}"""
    if LIBRARY_FILE.is_file():
        try:
            return json.loads(LIBRARY_FILE.read_text())
        except Exception:
            pass
    return {"bookmarks": {}, "synced_ids": [], "last_sync": None, "total_syncs": 0}


def _save_library(lib: dict) -> None:
    PLUGIN_DIR.mkdir(parents=True, exist_ok=True)
    LIBRARY_FILE.write_text(json.dumps(lib, indent=2))


def _load_research(bookmark_id: str) -> dict | None:
    path = RESEARCH_DIR / f"{bookmark_id}.json"
    if path.is_file():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    return None


def _save_research(bookmark_id: str, research: dict) -> None:
    RESEARCH_DIR.mkdir(parents=True, exist_ok=True)
    path = RESEARCH_DIR / f"{bookmark_id}.json"
    path.write_text(json.dumps(research, indent=2))


def _load_schedule() -> dict:
    if SCHEDULE_FILE.is_file():
        try:
            return json.loads(SCHEDULE_FILE.read_text())
        except Exception:
            pass
    return {"enabled": False, "interval_minutes": 60, "last_check": None, "next_check": None}


def _save_schedule(sched: dict) -> None:
    PLUGIN_DIR.mkdir(parents=True, exist_ok=True)
    SCHEDULE_FILE.write_text(json.dumps(sched, indent=2))


# ── Auto-tagging ────────────────────────────────────────────────────
TAG_PATTERNS = {
    "ai": r"\b(ai|llm|gpt|claude|gemini|openai|anthropic|model|neural|transformer|machine.?learning|deep.?learning|inference|fine.?tun|embedding|rag|agent|mcp|langchain|llamaindex)\b",
    "dev-tools": r"\b(cli|sdk|api|framework|library|package|npm|pip|pnpm|cargo|tool|devtool|linter|formatter|bundler|compiler|debugger|profiler)\b",
    "browser": r"\b(browser|extension|chrome|firefox|puppeteer|playwright|selenium|dom|scraping|automation|headless|webdriver|page.?agent)\b",
    "seo": r"\b(seo|ranking|backlink|serp|search.?engine|keyword|indexing|sitemap|schema.?markup|google.?search|dataforseo)\b",
    "infrastructure": r"\b(docker|container|kubernetes|k8s|server|vps|deploy|devops|ci.?cd|nginx|cloudflare|aws|gcp|azure|terraform|ansible)\b",
    "design": r"\b(ui|ux|design|css|tailwind|figma|frontend|component|layout|responsive|animation|svg|canvas)\b",
    "business": r"\b(revenue|pricing|startup|saas|marketing|growth|conversion|retention|monetiz|business.?model|founder)\b",
    "open-source": r"\b(open.?source|github|repo|mit.?license|apache|foss|contributor|pull.?request|fork)\b",
    "security": r"\b(security|vulnerabilit|exploit|auth|encrypt|jwt|oauth|xss|csrf|injection|pentest|cve)\b",
    "data": r"\b(database|sql|postgres|sqlite|redis|mongo|data.?pipeline|etl|analytics|dashboard|visualization|chart)\b",
    "video": r"\b(video|youtube|stream|remotion|ffmpeg|render|animation|motion)\b",
    "voice": r"\b(voice|tts|stt|speech|audio|whisper|orpheus|elevenlabs|resemble)\b",
}


def _auto_tag(text: str, links: list) -> list:
    """Auto-tag a bookmark based on its text and links."""
    combined = (text + " " + " ".join(links)).lower()
    tags = []
    for tag, pattern in TAG_PATTERNS.items():
        if re.search(pattern, combined, re.IGNORECASE):
            tags.append(tag)
    # Add github tag if any link is a github URL
    if any("github.com" in l for l in links):
        if "open-source" not in tags:
            tags.append("open-source")
    return tags


# ── Permission definitions ──────────────────────────────────────────
# Each permission controls a category of X API actions.
# Only "bookmarks_read" is enabled by default. Everything else is OFF
# and shows a ban-risk warning in the settings UI.
PERMISSIONS = {
    "bookmarks_read": {
        "label": "Read Bookmarks",
        "description": "Fetch your saved bookmarks",
        "default": True,
        "risk": "safe",
    },
    "search_tweets": {
        "label": "Search Tweets",
        "description": "Search public tweets by keyword",
        "default": False,
        "risk": "low",
        "warning": "High-volume searching may trigger rate limits.",
    },
    "read_timeline": {
        "label": "Read Timeline",
        "description": "View your home timeline",
        "default": False,
        "risk": "low",
        "warning": "Read-only, but frequent access may flag your account.",
    },
    "read_user_profiles": {
        "label": "Read User Profiles",
        "description": "Look up user profiles and their tweets",
        "default": False,
        "risk": "low",
        "warning": "Bulk profile lookups may trigger rate limits.",
    },
    "like_tweets": {
        "label": "Like Tweets",
        "description": "Like tweets on your behalf",
        "default": False,
        "risk": "high",
        "warning": "WRITE ACTION. Automated liking can get your account suspended. X actively detects and bans automated engagement.",
    },
    "post_tweets": {
        "label": "Post Tweets",
        "description": "Post tweets from your account",
        "default": False,
        "risk": "high",
        "warning": "WRITE ACTION. Automated posting can get your account permanently banned. X monitors for bot-like posting patterns.",
    },
    "send_dms": {
        "label": "Send Direct Messages",
        "description": "Send DMs from your account",
        "default": False,
        "risk": "critical",
        "warning": "WRITE ACTION. Automated DMs are the #1 cause of permanent account bans. X has zero tolerance for automated DM activity.",
    },
    "follow_unfollow": {
        "label": "Follow/Unfollow Users",
        "description": "Follow or unfollow accounts",
        "default": False,
        "risk": "high",
        "warning": "WRITE ACTION. Automated follow/unfollow is aggressively detected and punished by X. Accounts get locked or banned.",
    },
    "retweet": {
        "label": "Retweet/Quote",
        "description": "Retweet or quote tweets",
        "default": False,
        "risk": "high",
        "warning": "WRITE ACTION. Automated retweeting can trigger account suspension.",
    },
}


def _get_permissions(config: dict) -> dict:
    """Get current permissions, filling in defaults for any not set."""
    saved = config.get("permissions", {})
    result = {}
    for key, perm in PERMISSIONS.items():
        result[key] = saved.get(key, perm["default"])
    return result


def _check_permission(config: dict, permission: str) -> bool:
    """Check if a specific permission is enabled."""
    perms = _get_permissions(config)
    return perms.get(permission, False)


def _load_config() -> dict:
    if CONFIG_FILE.is_file():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except Exception as e:
            logger.warning(f"Failed to read Twitter config: {e}")
    return {}


def _save_config(config: dict) -> None:
    PLUGIN_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(config, indent=2))


def _fetch_bookmarks(ct0: str, auth_token: str, count: int = 20) -> dict:
    """Fetch bookmarks from X's internal GraphQL API."""
    import http.client
    import ssl

    variables = json.dumps({"count": count})
    features = json.dumps(FEATURES)

    params = urllib.parse.urlencode({
        "variables": variables,
        "features": features,
    })

    url = f"/i/api/graphql/Z9GWmP0kP2dajyckAaDUBw/Bookmarks?{params}"

    headers = {
        "Authorization": f"Bearer {BEARER}",
        "x-csrf-token": ct0,
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
        "cookie": f"ct0={ct0}; auth_token={auth_token}",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Content-Type": "application/json",
    }

    ctx = ssl.create_default_context()
    conn = http.client.HTTPSConnection("x.com", timeout=REQUEST_TIMEOUT, context=ctx)

    try:
        conn.request("GET", url, headers=headers)
        resp = conn.getresponse()
        body = resp.read().decode("utf-8")

        if resp.status != 200:
            return {"error": f"HTTP {resp.status}", "status_code": resp.status}

        return json.loads(body)
    except Exception as e:
        return {"error": str(e), "status_code": 0}
    finally:
        conn.close()


def _parse_bookmarks(data: dict) -> list:
    """Parse the GraphQL response into clean bookmark objects."""
    bookmarks = []
    instructions = (
        data.get("data", {})
        .get("bookmark_timeline_v2", {})
        .get("timeline", {})
        .get("instructions", [])
    )

    for inst in instructions:
        if inst.get("type") != "TimelineAddEntries":
            continue
        for entry in inst.get("entries", []):
            if not entry.get("entryId", "").startswith("tweet-"):
                continue

            result = (
                entry.get("content", {})
                .get("itemContent", {})
                .get("tweet_results", {})
                .get("result", {})
            )
            legacy = result.get("legacy", {})
            user = (
                result.get("core", {})
                .get("user_results", {})
                .get("result", {})
            )
            user_core = user.get("core", {})
            user_legacy = user.get("legacy", {})

            # Extract links
            links = []
            for url_obj in legacy.get("entities", {}).get("urls", []):
                links.append(
                    url_obj.get("expanded_url", url_obj.get("url", ""))
                )

            # Extract media
            media = []
            for m in legacy.get("entities", {}).get("media", []):
                media.append({
                    "type": m.get("type"),
                    "url": m.get("media_url_https", m.get("url", "")),
                })
            for m in (legacy.get("extended_entities") or {}).get("media", []):
                if m.get("type") == "video":
                    variants = m.get("video_info", {}).get("variants", [])
                    mp4s = [
                        v
                        for v in variants
                        if v.get("content_type") == "video/mp4"
                    ]
                    if mp4s:
                        best = max(mp4s, key=lambda v: v.get("bitrate", 0))
                        media.append({
                            "type": "video",
                            "url": best.get("url", ""),
                        })

            bookmark = {
                "id": legacy.get(
                    "id_str",
                    entry.get("entryId", "").replace("tweet-", ""),
                ),
                "author": user_core.get("screen_name", ""),
                "author_name": user_core.get("name", ""),
                "author_followers": user_legacy.get("followers_count", 0),
                "text": legacy.get("full_text", ""),
                "posted_at": legacy.get("created_at", ""),
                "likes": legacy.get("favorite_count", 0),
                "retweets": legacy.get("retweet_count", 0),
                "replies": legacy.get("reply_count", 0),
                "views": result.get("views", {}).get("count", "0"),
                "links": links,
                "media": media,
            }
            bookmarks.append(bookmark)

    return bookmarks


# ── Endpoints ────────────────────────────────────────────────────────


@twitter_bookmarks_bp.route("/api/twitter/config", methods=["GET"])
def get_config():
    config = _load_config()
    safe = dict(config)

    # Mask cookies for display
    if safe.get("ct0"):
        safe["ct0_preview"] = safe["ct0"][:16] + "..."
        safe["ct0_set"] = True
        del safe["ct0"]
    else:
        safe["ct0_set"] = False
        safe["ct0_preview"] = ""

    if safe.get("auth_token"):
        safe["auth_token_preview"] = safe["auth_token"][:8] + "..."
        safe["auth_token_set"] = True
        del safe["auth_token"]
    else:
        safe["auth_token_set"] = False
        safe["auth_token_preview"] = ""

    safe["configured"] = bool(
        config.get("ct0") and config.get("auth_token")
    )
    safe["permissions"] = _get_permissions(config)
    return jsonify(safe)


@twitter_bookmarks_bp.route("/api/twitter/config", methods=["POST"])
def save_config():
    data = request.get_json(silent=True) or {}

    ct0 = (data.get("ct0") or "").strip()
    auth_token = (data.get("auth_token") or "").strip()

    if not ct0:
        return jsonify({"error": "ct0 cookie value is required"}), 400
    if not auth_token:
        return jsonify({"error": "auth_token cookie value is required"}), 400

    config = _load_config()
    config["ct0"] = ct0
    config["auth_token"] = auth_token
    config["configured_at"] = datetime.now(timezone.utc).isoformat()

    # Test the connection immediately
    test_data = _fetch_bookmarks(ct0, auth_token, count=1)
    if "error" in test_data:
        config["last_test"] = {
            "ok": False,
            "message": test_data["error"],
        }
        _save_config(config)
        return jsonify({
            "ok": False,
            "error": f"Connection failed: {test_data['error']}",
        }), 400

    bookmarks = _parse_bookmarks(test_data)
    config["last_test"] = {
        "ok": True,
        "message": f"Connected. Found {len(bookmarks)} bookmark(s).",
        "tested_at": datetime.now(timezone.utc).isoformat(),
    }
    _save_config(config)

    return jsonify({
        "ok": True,
        "message": f"Connected. Found {len(bookmarks)} bookmark(s) in test fetch.",
    })


@twitter_bookmarks_bp.route("/api/twitter/status", methods=["GET"])
def get_status():
    config = _load_config()
    result = {
        "configured": bool(config.get("ct0") and config.get("auth_token")),
        "configured_at": config.get("configured_at"),
        "last_test": config.get("last_test"),
    }

    if result["configured"]:
        test_data = _fetch_bookmarks(
            config["ct0"], config["auth_token"], count=1
        )
        if "error" in test_data:
            result["connection"] = {
                "ok": False,
                "message": test_data["error"],
            }
        else:
            result["connection"] = {
                "ok": True,
                "message": "Connected",
            }
    else:
        result["connection"] = {"ok": False, "message": "Not configured"}

    return jsonify(result)


@twitter_bookmarks_bp.route("/api/twitter/bookmarks", methods=["GET"])
def get_bookmarks():
    config = _load_config()
    if not config.get("ct0") or not config.get("auth_token"):
        return jsonify({"error": "Twitter not configured. Install the plugin first."}), 400

    if not _check_permission(config, "bookmarks_read"):
        return jsonify({"error": "Bookmark reading is disabled. Enable it in Twitter Bookmarks settings."}), 403

    count = request.args.get("count", 20, type=int)
    count = min(count, 100)  # Cap at 100

    data = _fetch_bookmarks(config["ct0"], config["auth_token"], count=count)
    if "error" in data:
        return jsonify({"error": data["error"]}), 502

    bookmarks = _parse_bookmarks(data)
    return jsonify({
        "count": len(bookmarks),
        "bookmarks": bookmarks,
    })


@twitter_bookmarks_bp.route("/api/twitter/permissions", methods=["GET"])
def get_permissions():
    """Return all permissions with their current state and metadata."""
    config = _load_config()
    current = _get_permissions(config)

    result = []
    for key, meta in PERMISSIONS.items():
        result.append({
            "id": key,
            "label": meta["label"],
            "description": meta["description"],
            "enabled": current.get(key, meta["default"]),
            "risk": meta["risk"],
            "warning": meta.get("warning", ""),
            "default": meta["default"],
        })
    return jsonify(result)


@twitter_bookmarks_bp.route("/api/twitter/permissions", methods=["POST"])
def set_permissions():
    """Update permissions. Expects JSON: {permission_id: bool, ...}."""
    data = request.get_json(silent=True) or {}
    config = _load_config()

    if "permissions" not in config:
        config["permissions"] = {}

    changed = []
    for key, value in data.items():
        if key in PERMISSIONS and isinstance(value, bool):
            config["permissions"][key] = value
            changed.append(key)

    if changed:
        config["permissions_updated_at"] = datetime.now(timezone.utc).isoformat()
        _save_config(config)

    return jsonify({
        "ok": True,
        "updated": changed,
        "permissions": _get_permissions(config),
    })


# ── Library endpoints ───────────────────────────────────────────────


@twitter_bookmarks_bp.route("/api/twitter/library", methods=["GET"])
def get_library():
    """
    Get stored bookmarks with search, filter, and pagination.
    Query params: q (search), tag (filter), status (all|researched|pending),
                  sort (newest|oldest|popular), limit, offset
    """
    lib = _load_library()
    bookmarks = list(lib.get("bookmarks", {}).values())

    q = (request.args.get("q") or "").strip().lower()
    tag = (request.args.get("tag") or "").strip()
    status = (request.args.get("status") or "all").strip()
    sort = (request.args.get("sort") or "newest").strip()
    limit = request.args.get("limit", 50, type=int)
    offset = request.args.get("offset", 0, type=int)

    # Filter by search
    if q:
        bookmarks = [
            b for b in bookmarks
            if q in b.get("text", "").lower()
            or q in b.get("author", "").lower()
            or q in b.get("author_name", "").lower()
            or any(q in t for t in b.get("tags", []))
        ]

    # Filter by tag
    if tag:
        bookmarks = [b for b in bookmarks if tag in b.get("tags", [])]

    # Filter by research status
    if status == "researched":
        bookmarks = [b for b in bookmarks if b.get("research_status") == "done"]
    elif status == "pending":
        bookmarks = [b for b in bookmarks if b.get("research_status") != "done"]

    # Sort
    if sort == "newest":
        bookmarks.sort(key=lambda b: b.get("synced_at", ""), reverse=True)
    elif sort == "oldest":
        bookmarks.sort(key=lambda b: b.get("synced_at", ""))
    elif sort == "popular":
        bookmarks.sort(key=lambda b: int(b.get("views", "0") or "0"), reverse=True)

    total = len(bookmarks)
    bookmarks = bookmarks[offset:offset + limit]

    return jsonify({
        "total": total,
        "offset": offset,
        "limit": limit,
        "bookmarks": bookmarks,
        "last_sync": lib.get("last_sync"),
        "total_syncs": lib.get("total_syncs", 0),
    })


@twitter_bookmarks_bp.route("/api/twitter/library/sync", methods=["POST"])
def sync_library():
    """Fetch new bookmarks from X and add to library."""
    config = _load_config()
    if not config.get("ct0") or not config.get("auth_token"):
        return jsonify({"error": "Twitter not configured"}), 400

    if not _check_permission(config, "bookmarks_read"):
        return jsonify({"error": "Bookmark reading is disabled"}), 403

    count = request.args.get("count", 40, type=int)
    count = min(count, 100)

    data = _fetch_bookmarks(config["ct0"], config["auth_token"], count=count)
    if "error" in data:
        return jsonify({"error": data["error"]}), 502

    fresh = _parse_bookmarks(data)
    lib = _load_library()
    existing = lib.get("bookmarks", {})
    new_count = 0

    for bm in fresh:
        bid = bm["id"]
        if bid not in existing:
            bm["tags"] = _auto_tag(bm.get("text", ""), bm.get("links", []))
            bm["synced_at"] = datetime.now(timezone.utc).isoformat()
            bm["research_status"] = "pending"
            bm["user_tags"] = []
            existing[bid] = bm
            new_count += 1
        else:
            # Update engagement stats on existing
            existing[bid]["likes"] = bm.get("likes", existing[bid].get("likes", 0))
            existing[bid]["retweets"] = bm.get("retweets", existing[bid].get("retweets", 0))
            existing[bid]["views"] = bm.get("views", existing[bid].get("views", "0"))

    lib["bookmarks"] = existing
    lib["last_sync"] = datetime.now(timezone.utc).isoformat()
    lib["total_syncs"] = lib.get("total_syncs", 0) + 1
    _save_library(lib)

    return jsonify({
        "ok": True,
        "new_bookmarks": new_count,
        "total_bookmarks": len(existing),
        "synced_at": lib["last_sync"],
    })


@twitter_bookmarks_bp.route("/api/twitter/library/<bookmark_id>", methods=["GET"])
def get_bookmark_detail(bookmark_id):
    """Get a single bookmark with its research data."""
    lib = _load_library()
    bm = lib.get("bookmarks", {}).get(bookmark_id)
    if not bm:
        return jsonify({"error": "Bookmark not found"}), 404

    research = _load_research(bookmark_id)
    result = dict(bm)
    result["research"] = research
    return jsonify(result)


@twitter_bookmarks_bp.route("/api/twitter/library/<bookmark_id>/tags", methods=["POST"])
def update_bookmark_tags(bookmark_id):
    """Update tags for a bookmark. Expects JSON: {tags: [...]}."""
    data = request.get_json(silent=True) or {}
    tags = data.get("tags", [])

    lib = _load_library()
    bm = lib.get("bookmarks", {}).get(bookmark_id)
    if not bm:
        return jsonify({"error": "Bookmark not found"}), 404

    bm["user_tags"] = [str(t).strip() for t in tags if str(t).strip()]
    _save_library(lib)
    return jsonify({"ok": True, "tags": bm.get("tags", []), "user_tags": bm["user_tags"]})


@twitter_bookmarks_bp.route("/api/twitter/library/<bookmark_id>/research", methods=["POST"])
def save_bookmark_research(bookmark_id):
    """Save research results for a bookmark. Called by the agent after researching."""
    data = request.get_json(silent=True) or {}

    lib = _load_library()
    bm = lib.get("bookmarks", {}).get(bookmark_id)
    if not bm:
        return jsonify({"error": "Bookmark not found"}), 404

    research = {
        "summary": data.get("summary", ""),
        "what_it_is": data.get("what_it_is", ""),
        "relevance": data.get("relevance", []),
        "how_to_use": data.get("how_to_use", ""),
        "priority": data.get("priority", "medium"),
        "effort": data.get("effort", "moderate"),
        "category": data.get("category", ""),
        "linked_content": data.get("linked_content", {}),
        "researched_at": datetime.now(timezone.utc).isoformat(),
    }
    _save_research(bookmark_id, research)

    bm["research_status"] = "done"
    bm["researched_at"] = research["researched_at"]
    bm["research_priority"] = research["priority"]
    # Merge any discovered tags
    if data.get("discovered_tags"):
        for t in data["discovered_tags"]:
            if t not in bm.get("tags", []):
                bm.setdefault("tags", []).append(t)
    _save_library(lib)

    return jsonify({"ok": True, "research": research})


@twitter_bookmarks_bp.route("/api/twitter/library/<bookmark_id>/research", methods=["GET"])
def get_bookmark_research(bookmark_id):
    """Get research data for a bookmark."""
    research = _load_research(bookmark_id)
    if not research:
        return jsonify({"error": "No research found for this bookmark"}), 404
    return jsonify(research)


@twitter_bookmarks_bp.route("/api/twitter/library/<bookmark_id>/trigger-research", methods=["POST"])
def trigger_bookmark_research(bookmark_id):
    """Fetch linked content and produce research for a bookmark."""
    import http.client
    import ssl
    from html.parser import HTMLParser

    lib = _load_library()
    bm = lib.get("bookmarks", {}).get(bookmark_id)
    if not bm:
        return jsonify({"error": "Bookmark not found"}), 404

    bm["research_status"] = "researching"
    _save_library(lib)

    links = bm.get("links", [])
    text = bm.get("text", "")

    linked_content = []

    class MetaParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.title = ""
            self.description = ""
            self.in_title = False
            self.og = {}

        def handle_starttag(self, tag, attrs):
            if tag == "title":
                self.in_title = True
            if tag == "meta":
                adict = dict(attrs)
                name = adict.get("name", adict.get("property", "")).lower()
                content = adict.get("content", "")
                if name == "description" and not self.description:
                    self.description = content
                if name == "og:description" and not self.description:
                    self.description = content
                if name == "og:title" and not self.title:
                    self.title = content
                if name.startswith("og:"):
                    self.og[name] = content

        def handle_data(self, data):
            if self.in_title:
                self.title += data

        def handle_endtag(self, tag):
            if tag == "title":
                self.in_title = False

    for link in links[:5]:
        entry = {"url": link, "type": "unknown", "title": "", "description": ""}

        try:
            # Detect GitHub repos
            gh_match = re.match(r"https?://github\.com/([^/]+)/([^/?#]+)", link)
            if gh_match:
                owner, repo = gh_match.group(1), gh_match.group(2).rstrip(".git")
                entry["type"] = "github_repo"

                # Fetch repo info from GitHub API
                ctx = ssl.create_default_context()
                conn = http.client.HTTPSConnection("api.github.com", timeout=15, context=ctx)
                conn.request("GET", f"/repos/{owner}/{repo}", headers={
                    "User-Agent": "JamBot/1.0",
                    "Accept": "application/vnd.github.v3+json",
                })
                resp = conn.getresponse()
                if resp.status == 200:
                    repo_data = json.loads(resp.read().decode())
                    entry["title"] = repo_data.get("full_name", "")
                    entry["description"] = repo_data.get("description", "")
                    entry["stars"] = repo_data.get("stargazers_count", 0)
                    entry["forks"] = repo_data.get("forks_count", 0)
                    entry["language"] = repo_data.get("language", "")
                    entry["topics"] = repo_data.get("topics", [])
                    entry["license"] = (repo_data.get("license") or {}).get("spdx_id", "")
                    entry["updated_at"] = repo_data.get("updated_at", "")
                    entry["open_issues"] = repo_data.get("open_issues_count", 0)
                conn.close()

                # Fetch README
                conn = http.client.HTTPSConnection("api.github.com", timeout=15, context=ctx)
                conn.request("GET", f"/repos/{owner}/{repo}/readme", headers={
                    "User-Agent": "JamBot/1.0",
                    "Accept": "application/vnd.github.v3+json",
                })
                resp = conn.getresponse()
                if resp.status == 200:
                    readme_data = json.loads(resp.read().decode())
                    import base64
                    readme_b64 = readme_data.get("content", "")
                    try:
                        readme_text = base64.b64decode(readme_b64).decode("utf-8", errors="replace")
                        # Truncate to first 3000 chars
                        entry["readme"] = readme_text[:3000]
                    except Exception:
                        entry["readme"] = ""
                conn.close()

                linked_content.append(entry)
                continue

            # Generic URL — fetch page metadata
            from urllib.parse import urlparse
            parsed = urlparse(link)
            host = parsed.hostname or ""
            path = parsed.path or "/"

            if not host:
                continue

            entry["type"] = "webpage"
            ctx = ssl.create_default_context()
            use_ssl = parsed.scheme == "https"
            port = parsed.port or (443 if use_ssl else 80)

            if use_ssl:
                conn = http.client.HTTPSConnection(host, port, timeout=10, context=ctx)
            else:
                conn = http.client.HTTPConnection(host, port, timeout=10)

            conn.request("GET", path + ("?" + parsed.query if parsed.query else ""), headers={
                "User-Agent": "Mozilla/5.0 (compatible; JamBot/1.0)",
            })
            resp = conn.getresponse()
            if resp.status in (200, 301, 302):
                body = resp.read(50000).decode("utf-8", errors="replace")
                parser = MetaParser()
                try:
                    parser.feed(body)
                except Exception:
                    pass
                entry["title"] = parser.title.strip()[:200]
                entry["description"] = parser.description.strip()[:500]
            conn.close()

            linked_content.append(entry)

        except Exception as e:
            entry["error"] = str(e)[:200]
            linked_content.append(entry)

    # Build research object
    research = {
        "what_it_is": "",
        "summary": "",
        "relevance": [],
        "how_to_use": "",
        "priority": "medium",
        "effort": "moderate",
        "category": "",
        "linked_content": linked_content,
        "requirements": [],
        "costs": "",
        "install_steps": "",
        "researched_at": datetime.now(timezone.utc).isoformat(),
        "research_method": "auto-fetch",
    }

    # Auto-populate from GitHub data if available
    for lc in linked_content:
        if lc.get("type") == "github_repo":
            research["what_it_is"] = f"{lc.get('title', '')} — {lc.get('description', '')}"
            research["category"] = "tool"
            if lc.get("language"):
                research["requirements"].append(f"Language: {lc['language']}")
            if lc.get("license"):
                research["costs"] = f"Open source ({lc['license']})"
            else:
                research["costs"] = "Open source (check license)"
            if lc.get("stars", 0) > 1000:
                research["priority"] = "high"
            elif lc.get("stars", 0) > 100:
                research["priority"] = "medium"
            else:
                research["priority"] = "low"
            # Extract install from README
            readme = lc.get("readme", "")
            if readme:
                install_section = ""
                lines = readme.split("\n")
                in_install = False
                for line in lines:
                    ll = line.lower().strip()
                    if any(kw in ll for kw in ["## install", "## getting started", "## setup", "## quick start", "## usage"]):
                        in_install = True
                        install_section = ""
                        continue
                    elif in_install and line.startswith("## "):
                        break
                    elif in_install:
                        install_section += line + "\n"
                if install_section.strip():
                    research["install_steps"] = install_section.strip()[:1500]

                # Extract summary from first paragraph
                first_para = ""
                for line in lines:
                    stripped = line.strip()
                    if stripped and not stripped.startswith("#") and not stripped.startswith("[") and not stripped.startswith("!") and not stripped.startswith("<"):
                        first_para += stripped + " "
                        if len(first_para) > 300:
                            break
                if first_para.strip():
                    research["summary"] = first_para.strip()[:500]
            break
        elif lc.get("type") == "webpage":
            if lc.get("title") and not research["what_it_is"]:
                research["what_it_is"] = lc["title"]
            if lc.get("description") and not research["summary"]:
                research["summary"] = lc["description"]

    _save_research(bookmark_id, research)

    # Update library status
    lib = _load_library()
    bm = lib.get("bookmarks", {}).get(bookmark_id)
    if bm:
        bm["research_status"] = "done"
        bm["researched_at"] = research["researched_at"]
        bm["research_priority"] = research.get("priority", "medium")
        _save_library(lib)

    return jsonify({"ok": True, "research": research})


# ── Schedule endpoints ──────────────────────────────────────────────


@twitter_bookmarks_bp.route("/api/twitter/schedule", methods=["GET"])
def get_schedule():
    return jsonify(_load_schedule())


@twitter_bookmarks_bp.route("/api/twitter/schedule", methods=["POST"])
def set_schedule():
    data = request.get_json(silent=True) or {}
    sched = _load_schedule()

    if "enabled" in data:
        sched["enabled"] = bool(data["enabled"])
    if "interval_minutes" in data:
        mins = int(data["interval_minutes"])
        if mins < 15:
            mins = 15
        if mins > 1440:
            mins = 1440
        sched["interval_minutes"] = mins

    sched["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_schedule(sched)
    return jsonify({"ok": True, "schedule": sched})


# ── Tags endpoint ───────────────────────────────────────────────────


@twitter_bookmarks_bp.route("/api/twitter/tags", methods=["GET"])
def get_tags():
    """Get all tags with bookmark counts."""
    lib = _load_library()
    tag_counts = {}
    for bm in lib.get("bookmarks", {}).values():
        for t in bm.get("tags", []) + bm.get("user_tags", []):
            tag_counts[t] = tag_counts.get(t, 0) + 1
    # Sort by count descending
    sorted_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)
    return jsonify([{"tag": t, "count": c} for t, c in sorted_tags])


