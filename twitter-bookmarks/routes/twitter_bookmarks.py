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


# ── Language detection ──────────────────────────────────────────────
def _detect_language(text: str) -> str:
    """Simple language detection. Returns 'en', 'cjk', or 'other'."""
    cjk_count = sum(1 for c in text if '\u4e00' <= c <= '\u9fff' or '\u3040' <= c <= '\u309f' or '\u30a0' <= c <= '\u30ff' or '\uac00' <= c <= '\ud7af')
    if cjk_count > len(text) * 0.1 and cjk_count > 5:
        return "cjk"
    return "en"


# ── Title generation ───────────────────────────────────────────────
# Known product/brand names to detect and keep together
_KNOWN_NAMES = {
    "claude code", "google gemini", "alibaba cloud", "open source",
    "seo pages", "mcp server", "domain authority", "react native",
    "next.js", "node.js", "x bookmarks", "ai agent", "ai agents",
}

def _generate_title(text: str) -> str:
    """Extract a short 1-3 word topic title from tweet text."""
    clean = re.sub(r"https?://\S+", "", text).strip()
    clean = re.sub(r"@\w+", "", clean).strip()
    clean = re.sub(r"\*\*([^*]+)\*\*", r"\1", clean)  # strip markdown bold
    clean = re.sub(r"[^\w\s\-/.$#]", " ", clean).strip()  # strip emoji/symbols
    clean = re.sub(r"\s+", " ", clean).strip()
    if not clean:
        return "Shared Link"

    lower = clean.lower()
    # Check for known compound names first
    for name in _KNOWN_NAMES:
        if name in lower:
            return name.title()

    # Skip filler words and tweet openers
    skip = {
        "the", "a", "an", "this", "that", "just", "i", "my", "we", "so",
        "if", "is", "its", "it's", "here's", "here", "how", "what", "you",
        "your", "get", "breaking", "someone", "built", "huge", "sharing",
        "friendly", "reminder", "free", "new", "and", "but", "for", "with",
        "to", "of", "in", "on", "at", "by", "or", "not", "are", "was", "were",
        "been", "be", "have", "has", "had", "do", "does", "did", "will",
        "top", "best", "now", "today", "ever", "every", "why",
    }

    words = clean.split()
    # Collect meaningful words — prefer capitalized/technical terms
    meaningful = []
    for w in words:
        wc = re.sub(r"[^\w\-/.$#]", "", w)
        if not wc:
            continue
        if wc.lower() in skip:
            continue
        meaningful.append(wc)
        if len(meaningful) >= 3:
            break

    if meaningful:
        return " ".join(meaningful)[:40]

    # Fallback: just first 3 non-empty words
    fallback = [w for w in words if re.sub(r"[^\w]", "", w)][:3]
    return " ".join(fallback)[:40] if fallback else ""


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


# ── Web search discovery ──────────────────────────────────────────
def _serper_search(query: str, num_results: int = 5) -> list:
    """Search the web via Serper API. Returns list of {title, link, snippet}."""
    import http.client
    import ssl

    api_key = os.environ.get("SERPER_API_KEY", "")
    if not api_key:
        return []
    try:
        ctx = ssl.create_default_context()
        conn = http.client.HTTPSConnection("google.serper.dev", timeout=8, context=ctx)
        payload = json.dumps({"q": query, "num": num_results})
        conn.request("POST", "/search", body=payload, headers={
            "X-API-KEY": api_key,
            "Content-Type": "application/json",
        })
        resp = conn.getresponse()
        if resp.status == 200:
            data = json.loads(resp.read().decode())
            return data.get("organic", [])
        conn.close()
    except Exception as e:
        logger.warning(f"[Research] Serper search failed: {e}")
    return []


def _extract_product_names(text: str, links: list) -> list:
    """Extract product/tool names from tweet text and links. Prioritizes actual
    product names over @mentions (which are often people, not products)."""
    candidates = []

    # 1. Extract from link domains (skip social/video platforms) — highest signal
    skip_domains = {"twitter.com", "x.com", "youtube.com", "youtu.be", "t.co",
                    "bit.ly", "buff.ly", "ow.ly", "tinyurl.com", "linkedin.com",
                    "medium.com", "substack.com"}
    for link in links:
        match = re.search(r"https?://(?:www\.)?([^/]+)", link)
        if match:
            domain = match.group(1)
            if not any(s in domain for s in skip_domains):
                name = domain.split(".")[0]
                if len(name) > 2:
                    candidates.append(name.capitalize())

    # 2. Extract product names from text — look for capitalized words that
    #    are likely tools/products, not common English words or people's names
    clean = re.sub(r"https?://\S+", "", text)
    clean = re.sub(r"@\w+", "", clean)
    clean = re.sub(r"[^\w\s\-\.]", " ", clean)

    # Find single capitalized words (product names like Zapier, Claude, Cursor)
    words = clean.split()
    skip_words = {
        "breaking", "today", "new", "free", "how", "see", "the", "its", "just",
        "view", "here", "check", "watch", "read", "follow", "like", "share",
        "ceo", "cto", "someone", "everyone", "every", "gave", "gave", "all",
        "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
        "daily", "weekly", "monthly", "this", "that", "built", "released", "huge",
        "sharing", "introducing", "announcing", "access", "etc", "uses", "use",
    }
    for w in words:
        wclean = w.strip(".,!?:;")
        # Must start with uppercase and be >2 chars
        if wclean and wclean[0].isupper() and len(wclean) > 2:
            if wclean.lower() not in skip_words and wclean not in candidates:
                candidates.append(wclean)

    # 3. @mentions as FALLBACK only (often people, not products)
    #    Only include if the mention text also appears as a word in the tweet
    #    (e.g., @zapier when "Zapier" is in text = likely the product)
    mentions = re.findall(r"@(\w+)", text)
    skip_handles = {"everyone", "here", "elonmusk", "sama"}
    for m in mentions:
        if m.lower() not in skip_handles and len(m) > 2:
            # Only add if this mention name appears as a product word in text
            if m.lower() in text.lower().replace("@" + m, "").lower():
                candidates.append(m)

    # Deduplicate preserving order, case-insensitive
    seen = set()
    deduped = []
    for c in candidates:
        cl = c.lower()
        if cl not in seen:
            seen.add(cl)
            deduped.append(c)
    return deduped[:3]


def _extract_context_keywords(text: str) -> str:
    """Extract context keywords from tweet to refine search queries."""
    keywords = []
    context_terms = [
        "agent", "MCP", "SDK", "API", "tool", "framework", "extension",
        "plugin", "integration", "platform", "server", "client", "app",
        "CLI", "library", "package", "protocol", "automation",
    ]
    for term in context_terms:
        if term.lower() in text.lower():
            keywords.append(term)
    return " ".join(keywords[:3])


def _fetch_page_for_research(url: str, timeout: int = 6) -> dict:
    """Fetch a web page and extract useful text content."""
    import http.client
    import ssl
    from urllib.parse import urlparse

    result = {"url": url, "title": "", "text": "", "error": ""}
    try:
        parsed = urlparse(url)
        host = parsed.hostname or ""
        if not host:
            return result
        path = parsed.path or "/"
        req_path = path + ("?" + parsed.query if parsed.query else "")
        use_ssl = parsed.scheme == "https"
        port = parsed.port or (443 if use_ssl else 80)
        ctx = ssl.create_default_context()

        if use_ssl:
            conn = http.client.HTTPSConnection(host, port, timeout=timeout, context=ctx)
        else:
            conn = http.client.HTTPConnection(host, port, timeout=timeout)

        conn.request("GET", req_path, headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml",
        })
        resp = conn.getresponse()

        # Follow one redirect
        if resp.status in (301, 302, 303, 307, 308):
            redir = resp.getheader("Location", "")
            if redir:
                rp = urlparse(redir if redir.startswith("http") else f"{parsed.scheme}://{host}{redir}")
                conn.close()
                rhost = rp.hostname or host
                rport = rp.port or (443 if rp.scheme == "https" else 80)
                if rp.scheme == "https":
                    conn = http.client.HTTPSConnection(rhost, rport, timeout=timeout, context=ctx)
                else:
                    conn = http.client.HTTPConnection(rhost, rport, timeout=timeout)
                conn.request("GET", rp.path + ("?" + rp.query if rp.query else ""), headers={
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
                    "Accept": "text/html,application/xhtml+xml",
                })
                resp = conn.getresponse()

        if resp.status == 200:
            body = resp.read(150000).decode("utf-8", errors="replace")
            # Extract title
            title_match = re.search(r"<title[^>]*>(.*?)</title>", body, re.DOTALL | re.IGNORECASE)
            if title_match:
                result["title"] = re.sub(r"\s+", " ", title_match.group(1)).strip()[:200]

            # Extract main content — prefer <main>, <article>, or role="main"
            main_body = body
            for tag_pattern in [
                r"<main[^>]*>(.*?)</main>",
                r"<article[^>]*>(.*?)</article>",
                r'<div[^>]*role="main"[^>]*>(.*?)</div>',
            ]:
                main_match = re.search(tag_pattern, body, re.DOTALL | re.IGNORECASE)
                if main_match and len(main_match.group(1)) > 200:
                    main_body = main_match.group(1)
                    break

            # Strip nav, header, footer, sidebar, script, style
            clean = re.sub(r"<(script|style|nav|header|footer|aside|svg)[^>]*>.*?</\1>", "", main_body, flags=re.DOTALL | re.IGNORECASE)
            text = re.sub(r"<[^>]+>", " ", clean)
            text = re.sub(r"\s+", " ", text).strip()
            result["text"] = text[:5000]
        conn.close()
    except Exception as e:
        result["error"] = str(e)[:200]
    return result


def _discover_official_links(text: str, links: list, existing_content: list, time_budget: float = 12.0) -> dict:
    """
    Search the web to find official docs, install guides, pricing, and GitHub repos
    for products/tools mentioned in a tweet. Returns {official_links, extra_install, extra_costs}.
    """
    start = time.time()

    product_names = _extract_product_names(text, links)
    if not product_names:
        return {"official_links": []}

    context = _extract_context_keywords(text)
    official_links = []
    extra_install = ""
    extra_costs = ""
    seen_urls = set()

    # Skip if we already have a GitHub repo with good README
    has_github = any(lc.get("type") == "github_repo" and lc.get("readme") for lc in existing_content)
    if has_github:
        return {"official_links": []}

    for product in product_names[:2]:
        if time.time() - start > time_budget:
            break

        search_base = f"{product} {context}".strip() if context else product

        # Build targeted searches
        searches = [
            (f"{search_base} official documentation getting started site:{product.lower()}.com OR site:docs.{product.lower()}.com OR site:github.com", "docs"),
            (f"{search_base} how to install setup guide tutorial", "install"),
            (f"{product} pricing plans cost free", "pricing"),
        ]

        for query, link_type in searches:
            if time.time() - start > time_budget:
                break
            results = _serper_search(query, num_results=3)

            for sr in results[:3]:
                url = sr.get("link", "")
                title = sr.get("title", "")
                snippet = sr.get("snippet", "")
                if not url or url in seen_urls:
                    continue
                # Skip social media / video links in results
                if any(d in url for d in ["youtube.com", "youtu.be", "twitter.com", "x.com", "reddit.com", "facebook.com"]):
                    continue
                seen_urls.add(url)
                official_links.append({
                    "url": url,
                    "title": title,
                    "snippet": snippet,
                    "link_type": link_type,
                    "product": product,
                })

        # Fetch the best docs/install page for actual content
        # Prefer install links, help pages, and docs pages over blog posts
        docs_links = [l for l in official_links if l["link_type"] in ("docs", "install") and l["product"] == product]
        # Sort: install first, then help/docs domains, then blogs last
        def _link_priority(link):
            url = link.get("url", "").lower()
            lt = link.get("link_type", "")
            score = 0
            if lt == "install":
                score += 10
            if "/help/" in url or "help." in url or "docs." in url:
                score += 5
            if "/getting-started" in url or "/quickstart" in url or "/setup" in url:
                score += 3
            if "/blog/" in url:
                score -= 5
            return -score
        docs_links.sort(key=_link_priority)

        # Try up to 2 pages to find install content
        for dl in docs_links[:2]:
            if extra_install or time.time() - start > time_budget:
                break
            page = _fetch_page_for_research(dl["url"], timeout=6)
            if page.get("text") and len(page["text"]) > 100:
                page_text = page["text"]
                # Extract install-like content (commands, steps)
                install_markers = ["install", "getting started", "setup", "quick start",
                                   "step 1", "step 2", "create", "configure", "connect",
                                   "npm ", "pip ", "pnpm ", "brew ", "curl ", "docker ",
                                   "npx ", "yarn ", "cargo ", "go get", "gem install",
                                   "sign up", "log in", "click"]
                for marker in install_markers:
                    idx = page_text.lower().find(marker)
                    if idx >= 0:
                        start_idx = max(0, idx - 100)
                        end_idx = min(len(page_text), idx + 1500)
                        section = page_text[start_idx:end_idx].strip()
                        if len(section) > 50:
                            extra_install = section[:1500]
                            break

        # Fetch pricing page for actual cost info
        pricing_links = [l for l in official_links if l["link_type"] == "pricing" and l["product"] == product]
        if pricing_links and not extra_costs and time.time() - start < time_budget:
            page = _fetch_page_for_research(pricing_links[0]["url"], timeout=6)
            if page.get("text") and len(page["text"]) > 50:
                page_text = page["text"]
                # Extract pricing-related content
                price_markers = ["free", "starter", "pro", "enterprise", "month", "year",
                                 "$", "pricing", "plan", "per seat", "per user", "unlimited"]
                for marker in price_markers:
                    idx = page_text.lower().find(marker)
                    if idx >= 0:
                        start_idx = max(0, idx - 200)
                        end_idx = min(len(page_text), idx + 1000)
                        section = page_text[start_idx:end_idx].strip()
                        if len(section) > 30:
                            extra_costs = section[:1000]
                            break

    # Deduplicate and cap official links — keep best per type, max 8 total
    # Prioritize: install > docs > pricing > github, skip duplicates by domain
    seen_domains = set()
    filtered_links = []
    for lt in ["install", "docs", "pricing", "github"]:
        for link in official_links:
            if link["link_type"] != lt:
                continue
            domain = re.search(r"https?://([^/]+)", link["url"])
            domain_key = (domain.group(1) if domain else "") + "|" + lt
            if domain_key not in seen_domains:
                seen_domains.add(domain_key)
                filtered_links.append(link)
            if len(filtered_links) >= 8:
                break
        if len(filtered_links) >= 8:
            break

    return {
        "official_links": filtered_links,
        "extra_install": extra_install,
        "extra_costs": extra_costs,
    }


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


def _fetch_tweet_replies(ct0: str, auth_token: str, tweet_id: str, author: str) -> list:
    """Fetch replies to a tweet and extract links from author's self-replies."""
    import http.client
    import ssl

    variables = json.dumps({
        "focalTweetId": tweet_id,
        "with_rux_injections": False,
        "rankingMode": "Relevance",
        "includePromotedContent": False,
        "withCommunity": True,
        "withQuickPromoteEligibilityTweetFields": False,
        "withBirdwatchNotes": True,
        "withVoice": True,
    })
    features = json.dumps(FEATURES)
    params = urllib.parse.urlencode({"variables": variables, "features": features})
    url = f"/i/api/graphql/nBS-WpgA6ZG0CyNHD517JQ/TweetDetail?{params}"

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
    conn = http.client.HTTPSConnection("x.com", timeout=10, context=ctx)

    found_links = []
    try:
        conn.request("GET", url, headers=headers)
        resp = conn.getresponse()
        body = resp.read().decode("utf-8")
        if resp.status != 200:
            return []

        data = json.loads(body)
        instructions = (
            data.get("data", {})
            .get("threaded_conversation_with_injections_v2", {})
            .get("instructions", [])
        )

        for inst in instructions:
            for entry in inst.get("entries", []):
                # Check conversation thread entries and reply entries
                items = []
                content = entry.get("content", {})
                if content.get("entryType") == "TimelineTimelineItem":
                    items.append(content)
                elif content.get("entryType") == "TimelineTimelineModule":
                    items.extend(content.get("items", []))

                for item in items:
                    item_content = item.get("itemContent", item.get("item", {}).get("itemContent", {}))
                    result = item_content.get("tweet_results", {}).get("result", {})
                    legacy = result.get("legacy", {})
                    user = (
                        result.get("core", {})
                        .get("user_results", {})
                        .get("result", {})
                        .get("core", {})
                    )
                    screen_name = user.get("screen_name", "").lower()

                    # Only look at replies from the same author
                    if screen_name != author.lower():
                        continue
                    # Skip the original tweet itself
                    tweet_id_str = legacy.get("id_str", "")
                    if tweet_id_str == tweet_id:
                        continue

                    # Extract links from this reply
                    for url_obj in legacy.get("entities", {}).get("urls", []):
                        expanded = url_obj.get("expanded_url", url_obj.get("url", ""))
                        if expanded and "t.co" not in expanded:
                            found_links.append(expanded)

    except Exception as e:
        logger.warning(f"[Research] Failed to fetch tweet replies: {e}")
    finally:
        conn.close()

    return found_links


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
            bm["title"] = _generate_title(bm.get("text", ""))
            bm["lang"] = _detect_language(bm.get("text", ""))
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
        "official_links": data.get("official_links", []),
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

    research_start = time.time()
    RESEARCH_BUDGET = 35  # seconds total for all link fetching + web search

    # Step 1: If no links, check the author's replies for links (people often drop GitHub links in replies)
    if not links and bm.get("author"):
        config = _load_config()
        if config.get("ct0") and config.get("auth_token"):
            try:
                reply_links = _fetch_tweet_replies(
                    config["ct0"], config["auth_token"],
                    bookmark_id, bm.get("author", "")
                )
                if reply_links:
                    links = reply_links[:3]
                    logger.info(f"[Research] Found {len(reply_links)} links in author replies: {links}")
            except Exception as e:
                logger.warning(f"[Research] Reply fetch failed: {e}")

    # Step 2: If still no links, try to find the project/tool on GitHub by searching tweet text
    if not links and text:
        try:
            clean_search = re.sub(r"https?://\S+", "", text)
            clean_search = re.sub(r"@\w+", "", clean_search)
            clean_search = re.sub(r"[^\w\s\-]", " ", clean_search)
            # Extract likely product/tool names: capitalized phrases, quoted names
            # Look for "It's called X" or "called X" patterns
            called_match = re.search(r"(?:called|named|introducing|announcing|built|launched)\s+([A-Z][\w\s\-]{2,40}?)(?:\.|,|\n|$)", text, re.IGNORECASE)
            if called_match:
                search_term = called_match.group(1).strip()
            else:
                # Fall back to extracting key nouns (skip common filler)
                skip = {"the","a","an","this","that","just","i","my","we","so","if","is","its",
                        "it","you","your","get","breaking","someone","built","sharing","free",
                        "new","and","but","for","with","to","of","in","on","at","by","or","not",
                        "how","here","what","no","can","all","every","been","from","into","any"}
                words = [w for w in clean_search.split() if w.lower() not in skip and len(w) > 2]
                search_term = " ".join(words[:4])

            if search_term and time.time() - research_start < RESEARCH_BUDGET:
                ctx = ssl.create_default_context()
                conn = http.client.HTTPSConnection("api.github.com", timeout=8, context=ctx)
                q = urllib.parse.quote(search_term)
                conn.request("GET", f"/search/repositories?q={q}&sort=stars&per_page=1", headers={
                    "User-Agent": "JamBot/1.0",
                    "Accept": "application/vnd.github.v3+json",
                })
                resp = conn.getresponse()
                if resp.status == 200:
                    search_data = json.loads(resp.read().decode())
                    items = search_data.get("items", [])
                    if items:
                        repo = items[0]
                        # Verify relevance: repo name or description should overlap with tweet
                        repo_name = (repo.get("full_name", "") + " " + (repo.get("description", "") or "")).lower()
                        tweet_lower = text.lower()
                        # Check if any significant word from search_term appears in repo
                        overlap = sum(1 for w in search_term.lower().split() if w in repo_name)
                        if overlap >= 1:
                            link = repo.get("html_url", "")
                            if link:
                                links = [link]
                                logger.info(f"[Research] Found GitHub repo for '{search_term}': {link}")
                conn.close()
        except Exception as e:
            logger.warning(f"[Research] GitHub search failed: {e}")

    for link in links[:3]:  # max 3 links, not 5
        if time.time() - research_start > RESEARCH_BUDGET:
            break
        entry = {"url": link, "type": "unknown", "title": "", "description": ""}

        try:
            # Detect GitHub repos
            gh_match = re.match(r"https?://github\.com/([^/]+)/([^/?#]+)", link)
            if gh_match:
                owner, repo = gh_match.group(1), gh_match.group(2).rstrip(".git")
                entry["type"] = "github_repo"

                # Fetch repo info from GitHub API
                ctx = ssl.create_default_context()
                conn = http.client.HTTPSConnection("api.github.com", timeout=8, context=ctx)
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
                conn = http.client.HTTPSConnection("api.github.com", timeout=8, context=ctx)
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
                conn = http.client.HTTPSConnection(host, port, timeout=6, context=ctx)
            else:
                conn = http.client.HTTPConnection(host, port, timeout=6)

            req_path = path + ("?" + parsed.query if parsed.query else "")
            conn.request("GET", req_path, headers={
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml",
            })
            resp = conn.getresponse()

            # Follow redirects (one hop)
            if resp.status in (301, 302, 303, 307, 308):
                redir = resp.getheader("Location", "")
                if redir:
                    from urllib.parse import urlparse as up2
                    rp = up2(redir if redir.startswith("http") else f"{parsed.scheme}://{host}{redir}")
                    rhost = rp.hostname or host
                    rport = rp.port or (443 if rp.scheme == "https" else 80)
                    conn.close()
                    if rp.scheme == "https":
                        conn = http.client.HTTPSConnection(rhost, rport, timeout=6, context=ctx)
                    else:
                        conn = http.client.HTTPConnection(rhost, rport, timeout=6)
                    conn.request("GET", rp.path + ("?" + rp.query if rp.query else ""), headers={
                        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
                        "Accept": "text/html,application/xhtml+xml",
                    })
                    resp = conn.getresponse()

            if resp.status == 200:
                body = resp.read(100000).decode("utf-8", errors="replace")
                parser = MetaParser()
                try:
                    parser.feed(body)
                except Exception:
                    pass
                entry["title"] = parser.title.strip()[:200]
                entry["description"] = parser.description.strip()[:500]

                # Extract readable text content from body
                import re as re2
                # Strip scripts, styles, nav, header, footer
                clean_body = re2.sub(r"<(script|style|nav|header|footer|aside)[^>]*>.*?</\1>", "", body, flags=re2.DOTALL | re2.IGNORECASE)
                # Strip all remaining tags
                page_text = re2.sub(r"<[^>]+>", " ", clean_body)
                page_text = re2.sub(r"\s+", " ", page_text).strip()
                # Keep first ~3000 chars of readable text
                if len(page_text) > 200:
                    entry["page_text"] = page_text[:3000]
            conn.close()

            linked_content.append(entry)

        except Exception as e:
            entry["error"] = str(e)[:200]
            linked_content.append(entry)

    # Step 3: Web search discovery — find official docs, install guides, pricing
    # Triggers when we don't have a good GitHub repo or the basic fetch was thin
    discovery = {"official_links": []}
    has_github_repo = any(lc.get("type") == "github_repo" and lc.get("readme") for lc in linked_content)
    remaining_budget = max(0, RESEARCH_BUDGET - (time.time() - research_start))
    if not has_github_repo and remaining_budget > 5:
        try:
            discovery = _discover_official_links(text, links, linked_content, time_budget=min(remaining_budget, 15))
            logger.info(f"[Research] Discovery found {len(discovery.get('official_links', []))} official links")
        except Exception as e:
            logger.warning(f"[Research] Discovery step failed: {e}")

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
        "official_links": discovery.get("official_links", []),
        "requirements": [],
        "costs": "",
        "install_steps": "",
        "researched_at": datetime.now(timezone.utc).isoformat(),
        "research_method": "auto-fetch" if not discovery.get("official_links") else "auto-fetch+search",
    }

    # Auto-populate from GitHub data if available
    populated = False
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
            populated = True
            break
        elif lc.get("type") == "webpage":
            if lc.get("title") and not research["what_it_is"]:
                research["what_it_is"] = lc["title"]
            if lc.get("description") and not research["summary"]:
                research["summary"] = lc["description"]
            # Use page_text for deeper summary if available
            page_text = lc.get("page_text", "")
            if page_text and len(page_text) > 100:
                # Extract first meaningful paragraph as extended summary
                paragraphs = [p.strip() for p in page_text.split(". ") if len(p.strip()) > 40]
                if paragraphs and not research["summary"]:
                    research["summary"] = ". ".join(paragraphs[:5])[:500]
                if not research["what_it_is"] and lc.get("title"):
                    research["what_it_is"] = lc["title"]
            populated = True

    # Populate from web search discovery if basic fetch didn't provide it
    def _is_nav_junk(text):
        """Detect navigation/sidebar/CSS text that leaked into content extraction."""
        if not text:
            return True
        # Nav junk: many short words, lots of title-case, few sentences
        words = text.split()
        if len(words) < 10:
            return True
        short_words = sum(1 for w in words[:50] if len(w) <= 3)
        if short_words > len(words[:50]) * 0.5:
            return True
        # Check for navigation patterns: repeated menu items
        if text.count("Getting Started") > 2 or text.count("Home") > 2:
            return True
        # CSS/HTML artifacts leaked into text
        if ".css-" in text or "var(--" in text or "{all:unset" in text:
            return True
        # HTML entities not decoded
        if text.count("&nbsp;") > 3 or text.count("&#x") > 5:
            return True
        return False

    extra_install = discovery.get("extra_install", "")
    extra_costs = discovery.get("extra_costs", "")

    # If page-extracted content is nav junk, build from search snippets instead
    if _is_nav_junk(extra_install):
        install_links = [l for l in discovery.get("official_links", []) if l.get("link_type") in ("install", "docs")]
        snippet_parts = []
        for link in install_links[:3]:
            if link.get("snippet"):
                snippet_parts.append(f"{link['title']}: {link['snippet']}\n  URL: {link['url']}")
        if snippet_parts:
            extra_install = "\n\n".join(snippet_parts)

    if _is_nav_junk(extra_costs):
        pricing_links = [l for l in discovery.get("official_links", []) if l.get("link_type") == "pricing"]
        snippet_parts = []
        for link in pricing_links[:3]:
            if link.get("snippet"):
                snippet_parts.append(f"{link['title']}: {link['snippet']}\n  URL: {link['url']}")
        if snippet_parts:
            extra_costs = "\n\n".join(snippet_parts)

    if not research["install_steps"] and extra_install:
        research["install_steps"] = extra_install
    if not research["costs"] and extra_costs:
        research["costs"] = extra_costs

    # Always derive relevance and how_to_use from tweet text
    clean_text = re.sub(r"https?://\S+", "", text).strip()
    clean_text = re.sub(r"\s+", " ", clean_text)
    auto_tags = _auto_tag(text, links)

    # Populate fields that are still empty
    if not research["what_it_is"] and clean_text:
        first_sent = re.split(r"[.!?\n]", clean_text)
        research["what_it_is"] = (first_sent[0].strip()[:200]) if first_sent else clean_text[:200]

    if not research["summary"] and clean_text:
        research["summary"] = clean_text[:500]

    if not research["category"] and auto_tags:
        research["category"] = auto_tags[0]

    # Generate relevance from tags
    if not research["relevance"]:
        tag_relevance = {
            "ai": "AI/LLM tool — potential integration with JamBot agent stack or client agents",
            "dev-tools": "Developer tool — could improve build pipeline, automation, or agent capabilities",
            "browser": "Browser automation — relevant to web scraping, testing, or browser extension work",
            "seo": "SEO tool — direct application to client SEO workflows and content strategy",
            "infrastructure": "Infrastructure tool — potential deployment, hosting, or DevOps improvement",
            "design": "Design resource — UI/UX patterns applicable to canvas pages or client sites",
            "business": "Business insight — strategy, pricing, or growth tactic for client businesses",
            "open-source": "Open source project — evaluate for adoption or integration",
            "security": "Security tool — review for hardening platform or client applications",
            "data": "Data/analytics tool — potential for dashboards, reporting, or data pipeline",
            "video": "Video tool — relevant to Remotion pipeline or content creation",
            "voice": "Voice/audio tool — relevant to TTS/STT stack or voice AI features",
        }
        for tag in auto_tags:
            if tag in tag_relevance:
                research["relevance"].append(tag_relevance[tag])

    # Generate how_to_use from content
    if not research["how_to_use"]:
        if any(lc.get("type") == "github_repo" for lc in linked_content):
            repo = next(lc for lc in linked_content if lc.get("type") == "github_repo")
            steps = []
            if repo.get("language"):
                steps.append(f"Requires {repo['language']} environment")
            steps.append(f"Clone from {repo.get('url', 'GitHub')}")
            if repo.get("readme"):
                steps.append("Follow README installation instructions")
            steps.append("Evaluate for integration with existing stack")
            research["how_to_use"] = ". ".join(steps)
        elif linked_content:
            research["how_to_use"] = "Visit linked page for full details. Evaluate for relevance to current projects."
        elif clean_text:
            # Extract action items from tweet text
            action_phrases = []
            for line in clean_text.split("\n"):
                line = line.strip()
                if line.startswith(("-", "•", "→", "*", "1", "2", "3")) and len(line) > 10:
                    action_phrases.append(line.lstrip("-•→* 0123456789."))
            if action_phrases:
                research["how_to_use"] = ". ".join(action_phrases[:5])[:500]
            else:
                research["how_to_use"] = "Review tweet thread for actionable details. Research mentioned tools/techniques further."

    # Priority from engagement if not already set by GitHub stars
    likes = int(bm.get("likes", 0) or 0)
    views = int(bm.get("views", 0) or 0)
    if research["priority"] == "medium":
        if likes > 500 or views > 100000:
            research["priority"] = "high"
        elif likes < 50 and views < 10000:
            research["priority"] = "low"

    # Effort estimation
    if any(lc.get("type") == "github_repo" for lc in linked_content):
        research["effort"] = "moderate"
    elif not linked_content:
        research["effort"] = "quick"

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


