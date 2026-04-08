# Twitter Bookmarks

You have access to the user's X/Twitter bookmarks through the OpenVoiceUI API.

## Fetching Bookmarks (Live)

```
GET /api/twitter/bookmarks?count=20
```
Fetches directly from X. Use for quick checks.

## Bookmark Library (Stored)

The library stores all synced bookmarks with auto-tags and research status.

### Sync new bookmarks into library
```
POST /api/twitter/library/sync?count=40
```
Returns: `{ok, new_bookmarks, total_bookmarks, synced_at}`

### Search stored bookmarks
```
GET /api/twitter/library?q=search&tag=ai&status=pending&sort=newest&limit=50
```
- `q` — text search (author, text, tags)
- `tag` — filter by tag (ai, dev-tools, browser, seo, infrastructure, design, business, open-source, security, data, video, voice)
- `status` — all, researched, pending
- `sort` — newest, oldest, popular

### Get bookmark detail
```
GET /api/twitter/library/<id>
```
Returns bookmark with research data if available.

### Save research results
```
POST /api/twitter/library/<id>/research
Content-Type: application/json

{
  "what_it_is": "One sentence: what this bookmark is about",
  "summary": "Detailed summary of the content",
  "relevance": ["How it applies to system A", "How it applies to system B"],
  "how_to_use": "Concrete steps to integrate or use this",
  "priority": "high|medium|low",
  "effort": "quick|moderate|significant",
  "category": "tool|technique|resource|news|insight",
  "discovered_tags": ["any", "new", "tags"],
  "linked_content": {
    "type": "github_repo|article|tool|product",
    "title": "Name of the linked content",
    "url": "https://...",
    "description": "What it does"
  },
  "official_links": [
    {
      "url": "https://docs.example.com/getting-started",
      "title": "Page title",
      "snippet": "Brief description from search result",
      "link_type": "docs|install|pricing|github",
      "product": "ProductName"
    }
  ]
}
```

### Update tags
```
POST /api/twitter/library/<id>/tags
Content-Type: application/json
{"tags": ["custom-tag-1", "custom-tag-2"]}
```

### Get all tags with counts
```
GET /api/twitter/tags
```

## Auth

Use the X-Agent-Key header: `X-Agent-Key: $AGENT_API_KEY`

Example:
```bash
curl -s "http://openvoiceui:5001/api/twitter/library?limit=10" \
  -H "X-Agent-Key: $AGENT_API_KEY"
```

## When the User Asks About Bookmarks

1. **"Check my bookmarks"** — Sync first (`POST /library/sync`), then show recent additions
2. **"Research my bookmarks"** — Sync, then for each pending bookmark: research linked content and save results via `POST /library/<id>/research`
3. **"Find that bookmark about X"** — Search with `GET /library?q=X`
4. **"What's new?"** — Sync and report new_bookmarks count + summaries

## How to Research a Bookmark

For each bookmark with `research_status: pending`:
1. Read the tweet text and identify what it's about
2. If it has links — fetch and analyze the linked content (GitHub repos, articles, tools)
3. Map it against the user's systems and interests
4. Save structured research via `POST /library/<id>/research`

## Connection Status
```
GET /api/twitter/status
```
If not configured, tell user to open the "Twitter Bookmarks Setup" page.
