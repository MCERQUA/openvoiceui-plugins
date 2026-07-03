"""
Hermes Agent gateway plugin — routes conversation to Hermes Agent REST API.

Provides two gateway modes:
  - hermes        : Standalone Hermes agent (REST /v1/chat/completions)
  - hermes-bridge : Hybrid mode — OpenClaw primary, Hermes for delegation via MCP

Both modes produce the same event protocol that conversation.py consumes.
Voice works identically in all modes: STT -> text -> gateway -> text -> TTS.

Streaming mode: Both gateways use stream=True to get real-time tool activity.
Tool markers (e.g. `💻 hostname`) are parsed from the content stream and emitted
as structured action events for the actions panel. Clean text (markers stripped)
is sent as delta events for TTS.
"""

import json
import logging
import os
import queue
import re
import threading
import time
from typing import Optional

import requests

from services.gateways.base import GatewayBase

logger = logging.getLogger(__name__)

# Hermes container hostname within the Docker network
HERMES_HOST = os.getenv("HERMES_HOST", "hermes")
HERMES_PORT = os.getenv("HERMES_PORT", "18790")
HERMES_BASE_URL = f"http://{HERMES_HOST}:{HERMES_PORT}"
HERMES_API_URL = f"{HERMES_BASE_URL}/v1/chat/completions"

# Timeout for Hermes API calls (seconds)
HERMES_TIMEOUT = int(os.getenv("HERMES_TIMEOUT", "300"))

# Bearer key for the Hermes API server. v0.10+ enforces this when Hermes binds
# to a non-loopback address (which JamBot tenants always do — 0.0.0.0:18790).
# The hermes container mints the key on first boot and writes it to its /opt/data/.env;
# the JamBot provisioner plumbs that value to this OVU container as HERMES_API_KEY.
# When unset (e.g. tenant on Hermes <= v0.9 or local dev with API_SERVER_HOST=127.0.0.1)
# the header is omitted so older deployments keep working.
HERMES_API_KEY = os.getenv("HERMES_API_KEY", "")

# Tenant identifier for X-Hermes-Session-Key (v0.13+ long-term memory scoping).
# JAMBOT_TENANT is set on every OVU container by docker-compose (e.g. "test-dev").
# Falls back to empty so single-tenant self-hosters who don't set it just omit the header.
HERMES_TENANT_SESSION_KEY = os.getenv("JAMBOT_TENANT", "")


# ---------------------------------------------------------------------------
# HERMES_API_KEY self-heal
# ---------------------------------------------------------------------------
# The hermes gateway mints a bearer key (API_SERVER_KEY) on first boot and
# enforces it on every request once it binds a non-loopback address (v0.10+),
# which every JamBot tenant does (0.0.0.0:18790). OVU must send that exact
# value as HERMES_API_KEY or every gateway call 401s.
#
# The JamBot provisioner is *supposed* to copy API_SERVER_KEY -> the OVU
# container's HERMES_API_KEY at provision time, but that plumbing step has
# gone missing before (src, 2026-07-01: plugin loaded fine because the
# HERMES_HOST gate passed, yet every voice turn silently fell back to OpenClaw
# with no clue why). Rather than depend on the provisioner, the plugin resolves
# the key itself from the sibling hermes-<tenant> container. OVU runs with the
# docker socket mounted, so we `docker exec` the sibling and read its
# /opt/data/.env (hermes keeps the minted key there — it is NOT exported into
# the process env, so `printenv` can't see it). This makes the plugin
# self-sufficient for every tenant, every OVU restart, with zero provisioner
# or manual .env work.


def _resolve_api_key_from_sibling(tenant: str) -> str:
    """Read the hermes container's minted API_SERVER_KEY from the sibling.

    Returns '' on any failure (no tenant, docker binary missing, socket
    unavailable, hermes not up yet, key absent). Callers degrade gracefully —
    they just omit the Authorization header and let hermes 401 if it enforces one.
    """
    if not tenant:
        return ""
    try:
        import subprocess
        proc = subprocess.run(
            ["docker", "exec", f"hermes-{tenant}", "sh", "-c",
             "grep -E '^API_SERVER_KEY=' /opt/data/.env 2>/dev/null | head -1"],
            capture_output=True, text=True, timeout=8,
        )
    except Exception as exc:  # FileNotFoundError (no docker), TimeoutExpired, ...
        logger.debug("hermes-agent: sibling API key lookup failed: %s", exc)
        return ""
    line = (proc.stdout or "").strip()
    if "=" not in line:
        return ""
    return line.split("=", 1)[1].strip()


def _refresh_hermes_api_key() -> str:
    """Force-re-resolve HERMES_API_KEY from the sibling (401 recovery).

    Used when the cached key has gone stale — e.g. hermes re-minted
    API_SERVER_KEY after a restart in which the provisioner failed to carry the
    key forward. Updates the module global + os.environ so the next
    _hermes_headers() call picks up the fresh value.
    """
    global HERMES_API_KEY
    key = _resolve_api_key_from_sibling(HERMES_TENANT_SESSION_KEY)
    if key:
        HERMES_API_KEY = key
        os.environ["HERMES_API_KEY"] = key
    return key


# Self-heal at plugin load. Skipped entirely (no subprocess) when HERMES_API_KEY
# is already plumbed by the provisioner, so correctly-provisioned tenants pay
# zero overhead. Only fires for tenants where the key is missing.
if not HERMES_API_KEY:
    _resolved = _resolve_api_key_from_sibling(HERMES_TENANT_SESSION_KEY)
    if _resolved:
        HERMES_API_KEY = _resolved
        os.environ["HERMES_API_KEY"] = _resolved
        logger.info(
            "hermes-agent: HERMES_API_KEY was unset — self-resolved from sibling "
            "hermes-%s container (provisioner had not plumbed it).",
            HERMES_TENANT_SESSION_KEY,
        )
    elif HERMES_TENANT_SESSION_KEY:
        logger.warning(
            "hermes-agent: HERMES_API_KEY unset and sibling lookup failed — gateway "
            "calls to hermes-%s will 401 until the key is available.",
            HERMES_TENANT_SESSION_KEY,
        )


def _hermes_headers(session_id: str = "", session_key: str = "") -> dict:
    """Build headers for every Hermes API call.

    - Authorization Bearer when HERMES_API_KEY is set (v0.10+ requirement).
    - X-Hermes-Session-Id pins per-conversation continuity (v0.7+).
    - X-Hermes-Session-Key scopes long-term memory per tenant (v0.13+).

    All three are optional from Hermes's perspective; missing values are simply
    not sent. Older Hermes versions ignore unknown headers.
    """
    headers = {"Content-Type": "application/json"}
    if HERMES_API_KEY:
        headers["Authorization"] = f"Bearer {HERMES_API_KEY}"
    if session_id:
        headers["X-Hermes-Session-Id"] = session_id
    if session_key:
        headers["X-Hermes-Session-Key"] = session_key
    return headers


def _hermes_post(payload: dict, session_id: str = "", session_key: str = ""):
    """POST to the Hermes chat API with one 401 key-refresh retry.

    Wraps the streaming chat-completions POST used by both gateway modes. On a
    401 the cached HERMES_API_KEY may be stale (hermes re-minted it after a
    restart where the provisioner dropped the key); re-resolve from the sibling
    container and retry exactly once. Any other status is returned as-is for the
    caller's existing error handling.
    """
    resp = requests.post(
        HERMES_API_URL,
        json=payload,
        stream=True,
        headers=_hermes_headers(session_id=session_id, session_key=session_key),
        timeout=HERMES_TIMEOUT,
    )
    if resp.status_code == 401:
        if _refresh_hermes_api_key():
            logger.warning(
                "hermes-agent: 401 from Hermes API — refreshed HERMES_API_KEY, retrying once."
            )
            try:
                resp.close()  # release the unconsumed streaming connection
            except Exception:
                pass
            resp = requests.post(
                HERMES_API_URL,
                json=payload,
                stream=True,
                headers=_hermes_headers(session_id=session_id, session_key=session_key),
                timeout=HERMES_TIMEOUT,
            )
    return resp


# ---------------------------------------------------------------------------
# Tool marker parsing
# ---------------------------------------------------------------------------
# Hermes emits inline markdown markers in the content stream like:
#   `💻 hostname`          -> tool_use: terminal
#   `🧠 +memory: "fact"`   -> tool_use: memory
#   `📖 /path/to/file`     -> tool_use: read_file
#
# We detect these, emit action events, and strip them from the text deltas
# so TTS doesn't read tool annotations aloud.

EMOJI_TOOL_MAP = {
    "\U0001f4bb": "terminal",        # 💻
    "\U0001f4d6": "read_file",       # 📖
    "\u270f\ufe0f": "write_file",    # ✏️
    "\U0001f50d": "search",          # 🔍 (right-pointing magnifying glass)
    "\U0001f50e": "search",          # 🔎 (left-pointing magnifying glass — Hermes uses this one)
    "\U0001f9e0": "memory",          # 🧠
    "\U0001f310": "browser",         # 🌐
    "\U0001f3a8": "image_generate",  # 🎨
    "\U0001f4cb": "skills_list",     # 📋
    "\U0001f465": "delegate_task",   # 👥
    "\u23f0":     "cronjob",         # ⏰
    "\U0001f4c1": "read_file",       # 📁 (Hermes folder listing)
    "\U0001f4dd": "write_file",      # 📝 (Hermes note/write variant)
}

# Build a regex that matches a backtick-wrapped tool marker.
# Pattern: ` <emoji> <detail> `  (the backticks are literal)
# We also match markers on their own line preceded/followed by newlines.
_emoji_group = "|".join(re.escape(e) for e in EMOJI_TOOL_MAP)
TOOL_MARKER_RE = re.compile(
    r"`(" + _emoji_group + r")\s+([^`]+)`"
)


def _parse_tool_marker(text: str):
    """
    If text contains a tool marker, return (emoji, tool_name, detail).
    Otherwise return None.
    """
    m = TOOL_MARKER_RE.search(text)
    if not m:
        return None
    emoji = m.group(1)
    detail = m.group(2).strip()
    tool_name = EMOJI_TOOL_MAP.get(emoji, "unknown")
    return emoji, tool_name, detail


_LINE_EMOJI_RE = re.compile(
    r"^(" + "|".join(re.escape(e) for e in EMOJI_TOOL_MAP) + r")\s+(.+?)$",
    re.MULTILINE,
)


def _strip_tool_markers(text: str) -> str:
    """Clean tool markers from response text so transcript stays readable.

    Two forms of marker exist:
      1. Backtick-wrapped:  `💻 hostname`    — stripped entirely (the proper
                                               form, captured via action events)
      2. Bare line:         💻 long command  — TRUNCATED to ~40 chars so the
                                               transcript shows that a tool ran
                                               without getting buried in huge
                                               multi-line shell invocations.
                                               The Action Console panel shows
                                               the full command verbose.
    """
    # Form 1 — backticked markers get stripped from text entirely
    cleaned = TOOL_MARKER_RE.sub("", text)

    # Form 2 — bare-line markers get truncated in place
    def _truncate_line(m):
        emoji = m.group(1)
        detail = m.group(2).strip()
        if len(detail) > 40:
            detail = detail[:40].rstrip() + "…"
        return f"{emoji} {detail}"
    cleaned = _LINE_EMOJI_RE.sub(_truncate_line, cleaned)

    # Collapse runs of blank lines left behind
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned


def _make_action_event(emoji: str, tool_name: str, detail: str) -> dict:
    """Build a structured action event dict for the actions panel.
    Format must match what app.js ActionConsole.processActions() expects:
      - action.type === 'tool'
      - action.name = tool_name
      - action.detail = detail
      - action.icon = emoji
      - action.phase = 'start' (Hermes only sends tool-start markers)
    """
    return {
        "type": "action",
        "action": {
            "type": "tool",
            "name": tool_name,
            "detail": detail,
            "icon": emoji,
            "phase": "start",
        },
    }


# ---------------------------------------------------------------------------
# Streaming SSE line parser
# ---------------------------------------------------------------------------

def _iter_sse_content(response):
    """
    Yield typed events from a streaming SSE response.

    Yields:
      ("content", str)         — chat completion content delta
      ("tool_progress", dict)  — hermes.tool.progress event payload
                                 (Hermes v0.10+ structured tool lifecycle)

    SSE event-type tracking follows the protocol: an `event: <name>` line
    sets the type for the NEXT data payload; an empty line resets to
    default "message". Without this reset, our v0.6-era parser misread
    tool-progress events as content (silently dropped — no `choices`
    field) and the action panel showed nothing on v0.13.

    Expected wire format:
      Content delta (default "message" event):
        data: {"choices":[{"delta":{"content":"text"}}]}

      Tool event (custom):
        event: hermes.tool.progress
        data: {"tool":"terminal","emoji":"💻","label":"hostname","toolCallId":"...","status":"running"}

      Tool completion:
        event: hermes.tool.progress
        data: {"tool":"terminal","toolCallId":"...","status":"completed"}

      Stream terminator:
        data: [DONE]
    """
    current_event = "message"
    for line in response.iter_lines(decode_unicode=True):
        if not line:
            # SSE event boundary — reset to default "message" for the next event
            current_event = "message"
            continue
        if line.startswith("event: "):
            current_event = line[7:].strip()
            continue
        if not line.startswith("data: "):
            continue
        data_str = line[6:]
        if data_str.strip() == "[DONE]":
            break
        try:
            payload = json.loads(data_str)
        except json.JSONDecodeError:
            continue
        if current_event == "hermes.tool.progress":
            yield ("tool_progress", payload)
        else:
            # Default "message" event = OpenAI-compat chat completion chunk
            choices = payload.get("choices", [])
            if choices:
                content = choices[0].get("delta", {}).get("content")
                if content:
                    yield ("content", content)


# ---------------------------------------------------------------------------
# Streaming with tool marker extraction
# ---------------------------------------------------------------------------

class _StreamProcessor:
    """
    Accumulates SSE content deltas, detects tool markers, and dispatches
    action events and clean text deltas to the event queue.

    Tool markers may arrive split across multiple SSE chunks (e.g. the
    backtick in one chunk, the emoji in the next). We buffer partial
    content when a backtick is open and flush it once the closing backtick
    arrives or it becomes clear it's not a tool marker.
    """

    def __init__(self, event_queue: queue.Queue, captured_actions: list):
        self._queue = event_queue
        self._actions = captured_actions
        self._buffer = ""          # Accumulates text while inside a potential marker
        self._full_text = ""       # Complete response for text_done
        self._clean_text = ""      # Markers-stripped version

    def feed(self, chunk: str) -> None:
        """Process one SSE content delta."""
        self._buffer += chunk

        # Keep buffering if we have an unclosed backtick — the marker may
        # span multiple SSE chunks.
        if self._buffer.count("`") % 2 != 0:
            # Odd backtick count means one is still open.
            # Safety: flush if buffer grows unreasonably (not a real marker).
            if len(self._buffer) > 500:
                self._flush_as_text()
            return

        # All backticks are paired (or zero). Process the buffer.
        self._process_buffer()

    def finish(self) -> tuple:
        """Flush remaining buffer. Returns (full_text, clean_text)."""
        if self._buffer:
            self._flush_as_text()
        return self._full_text, self._clean_text

    def _process_buffer(self) -> None:
        """Parse buffered text for tool markers, emit events."""
        text = self._buffer
        self._buffer = ""

        # Check for tool markers
        markers = list(TOOL_MARKER_RE.finditer(text))
        if not markers:
            # No markers — emit as clean text delta
            self._emit_text(text)
            return

        # Walk through text, emitting text before/between/after markers
        # and action events for each marker.
        last_end = 0
        for m in markers:
            # Text before this marker
            before = text[last_end:m.start()]
            if before:
                self._emit_text(before)

            # Emit the action event
            emoji = m.group(1)
            detail = m.group(2).strip()
            tool_name = EMOJI_TOOL_MAP.get(emoji, "unknown")
            action_evt = _make_action_event(emoji, tool_name, detail)
            self._queue.put(action_evt)
            self._actions.append(action_evt["action"])

            # The marker text goes into full_text but NOT clean_text or delta
            self._full_text += text[m.start():m.end()]

            last_end = m.end()

        # Text after last marker
        after = text[last_end:]
        if after:
            self._emit_text(after)

    def _emit_text(self, text: str) -> None:
        """Send a text delta to the queue and accumulate into both buffers."""
        # Strip leading/trailing blank lines that surrounded markers
        stripped = text
        if stripped:
            self._full_text += stripped
            self._clean_text += stripped
            # Only emit non-whitespace-only deltas to avoid TTS hiccups
            if stripped.strip():
                self._queue.put({"type": "delta", "text": stripped})

    def emit_tool_progress(self, payload: dict) -> None:
        """Handle a Hermes v0.10+ structured tool-progress event.

        v0.13 dropped the legacy inline backtick markers (`💻 hostname`)
        and replaced them with `event: hermes.tool.progress` SSE events
        carrying {tool, emoji, label, toolCallId, status: running|completed}.

        On `running`, emit an action event for the panel using the same
        format _make_action_event produces. On `completed`, we currently
        no-op (the action panel only renders starts today — completed
        events could drive a tick/timing UI in a later pass).
        """
        status = payload.get("status", "")
        if status != "running":
            return
        tool_name = payload.get("tool", "unknown")
        emoji = payload.get("emoji", "")
        label = payload.get("label", tool_name)
        action_evt = _make_action_event(emoji, tool_name, label)
        # Carry the toolCallId so future patches can correlate completed events.
        action_evt["action"]["toolCallId"] = payload.get("toolCallId", "")
        self._queue.put(action_evt)
        self._actions.append(action_evt["action"])
        # Tool events don't add to clean_text or full_text — they're metadata,
        # not user-facing content. TTS already ignores them this way.

    def _flush_as_text(self) -> None:
        """Flush buffer as plain text (no marker found despite buffering)."""
        text = self._buffer
        self._buffer = ""
        if text:
            self._emit_text(text)


# ---------------------------------------------------------------------------
# Gateway implementations
# ---------------------------------------------------------------------------

class HermesGateway(GatewayBase):
    """
    Standalone Hermes gateway — sends conversation directly to Hermes Agent
    via its OpenAI-compatible REST API. Replaces OpenClaw as the agent brain.

    Use this when the user's framework mode is 'hermes' (Hermes only).
    Voice, canvas, and all OpenVoiceUI features work normally — only the
    backend agent brain changes.

    Profile config:
        "adapter_config": {
            "gateway_id": "hermes",
            "sessionKey": "hermes-main"
        }
    """

    gateway_id = "hermes"
    persistent = False  # REST per-request, no persistent connection

    def __init__(self):
        self._session_history: dict[str, list] = {}
        # Active runs tracked for mid-flight abort + steer. Hermes's
        # /v1/chat/completions is stateless per request, so "steer" here
        # means: close the in-flight HTTP connection (api_server.py
        # interrupts the agent on client disconnect) and re-fire a new
        # request with the steer message appended, reusing the SAME
        # event_queue so the browser's /api/conversation SSE keeps flowing
        # without the client noticing a seam.
        #
        # Key: session_key. Value: dict with:
        #   "response"        — the in-flight requests.Response (or None pre-send)
        #   "event_queue"     — the queue this run feeds (browser SSE bridge)
        #   "captured_actions"— the list stream_to_queue appends actions to
        #   "aborted_by_steer"— True if steer closed the run (suppresses text_done
        #                       so the replacement run emits the single terminal event)
        self._active_runs: dict[str, dict] = {}
        self._active_runs_lock = threading.Lock()

    def is_configured(self) -> bool:
        """Check if the Hermes container is reachable."""
        # Don't block startup with a health check — just verify env/config
        # The actual container may start after OpenVoiceUI
        return True

    def is_healthy(self) -> bool:
        """Live health check — ping the Hermes API."""
        try:
            resp = requests.get(
                f"{HERMES_BASE_URL}/health",
                headers=_hermes_headers(),
                timeout=5
            )
            return resp.ok
        except Exception:
            return False

    def stream_to_queue(
        self,
        event_queue: queue.Queue,
        message: str,
        session_key: str,
        captured_actions: Optional[list] = None,
        **kwargs,
    ) -> None:
        """
        Send user message to Hermes Agent REST API and stream response
        events into event_queue.

        Uses OpenAI-compatible /v1/chat/completions with streaming.
        Maintains per-session message history for multi-turn conversation.

        Tool markers in the stream (e.g. `💻 hostname`) are parsed into
        action events for the actions panel. Clean text (markers stripped)
        is sent as delta events for TTS.
        """
        if captured_actions is None:
            captured_actions = []

        start_ms = int(time.time() * 1000)

        # Build message history for this session
        if session_key not in self._session_history:
            self._session_history[session_key] = []

        history = self._session_history[session_key]
        history.append({"role": "user", "content": message})

        # Trim history to last 50 messages to prevent unbounded growth
        if len(history) > 50:
            history[:] = history[-50:]

        # Register this run as active for this session so send_steer /
        # abort_active_run can find and close it mid-flight. Any existing
        # active run for this session is replaced (should be rare — only
        # happens if a previous run is still draining after its abort).
        run_info = {
            "response": None,
            "event_queue": event_queue,
            "captured_actions": captured_actions,
            "aborted_by_steer": False,
        }
        with self._active_runs_lock:
            self._active_runs[session_key] = run_info

        resp = None
        try:
            # Sanitize before sending: drop any empty-content turns that may
            # already be sitting in the in-memory history (e.g. accumulated
            # before this fix shipped, or sent by a steer). Empty turns make
            # GLM return empty content; stripping them keeps a degraded
            # session from breaking new turns. Always preserves the final
            # user message (appended above, never empty).
            send_history = [
                m for m in history if str(m.get("content") or "").strip()
            ]
            resp = _hermes_post(
                {"model": "hermes-agent", "messages": send_history, "stream": True},
                session_id=session_key,
                session_key=HERMES_TENANT_SESSION_KEY,
            )
            run_info["response"] = resp

            if not resp.ok:
                error_text = resp.text[:500]
                logger.error(
                    f"Hermes API error {resp.status_code}: {error_text}"
                )
                event_queue.put({"type": "error", "error": f"Hermes API error: {resp.status_code}"})
                return

            # Report handshake latency with gateway name
            handshake_ms = int(time.time() * 1000) - start_ms
            event_queue.put({"type": "handshake", "ms": handshake_ms, "gateway": "hermes-agent"})

            # Stream with tool marker parsing
            processor = _StreamProcessor(event_queue, captured_actions)

            for kind, payload in _iter_sse_content(resp):
                if kind == "content":
                    processor.feed(payload)
                elif kind == "tool_progress":
                    processor.emit_tool_progress(payload)

            full_text, clean_text = processor.finish()

            # Non-streaming fallback: if streaming yielded nothing, try
            # parsing the response body as a non-streamed completion.
            if not full_text:
                try:
                    body = resp.json()
                    choices = body.get("choices", [])
                    if choices:
                        full_text = choices[0].get("message", {}).get("content", "")
                        if full_text:
                            clean = _strip_tool_markers(full_text)
                            # Emit any markers as actions
                            for m in TOOL_MARKER_RE.finditer(full_text):
                                emoji = m.group(1)
                                detail = m.group(2).strip()
                                tool_name = EMOJI_TOOL_MAP.get(emoji, "unknown")
                                act = _make_action_event(emoji, tool_name, detail)
                                event_queue.put(act)
                                captured_actions.append(act["action"])
                            if clean.strip():
                                event_queue.put({"type": "delta", "text": clean})
                            clean_text = clean
                except Exception:
                    pass

            if not full_text:
                logger.warning(f"Hermes: empty response for session {session_key}")

            # Store assistant response in history — but NEVER store an empty
            # turn. Empty assistant turns accumulate and poison the session:
            # GLM then returns empty content ("not a non-empty list"), which
            # cascades into more empties until every turn fails. On empty,
            # roll back the user message too so the failed turn leaves history
            # exactly as it was (clean alternation for the next real turn).
            if full_text:
                history.append({"role": "assistant", "content": full_text})
            elif history and history[-1].get("role") == "user":
                history.pop()

            # Only emit the terminal text_done if we weren't aborted by
            # a steer — the replacement run will emit its own.
            if not run_info["aborted_by_steer"]:
                event_queue.put({
                    "type": "text_done",
                    "response": full_text or "",
                    "actions": captured_actions,
                })

        except requests.Timeout:
            if not run_info["aborted_by_steer"]:
                logger.error(f"Hermes: timeout after {HERMES_TIMEOUT}s for session {session_key}")
                event_queue.put({"type": "error", "error": "Hermes Agent timed out"})

        except requests.ConnectionError:
            # A mid-flight steer closes the HTTP connection, which surfaces
            # here as ConnectionError on the next chunk read. That's not an
            # error — the replacement run will take over feeding the queue.
            if not run_info["aborted_by_steer"]:
                logger.error("Hermes: connection refused — is hermes container running?")
                event_queue.put({
                    "type": "error",
                    "error": "Cannot connect to Hermes Agent. The container may not be running.",
                })

        except Exception as exc:
            # Same deal — if the exception is a side-effect of our own
            # steer-driven close (requests raises various ChunkedEncoding /
            # ProtocolError variants depending on timing), swallow it.
            if not run_info["aborted_by_steer"]:
                logger.error(f"Hermes: unexpected error: {exc}")
                event_queue.put({"type": "error", "error": str(exc)})
            else:
                logger.debug(f"Hermes: run {session_key} interrupted by steer ({exc.__class__.__name__})")

        finally:
            # Deregister — but only if we're still the registered run.
            # send_steer may have already replaced us with the new run's info.
            with self._active_runs_lock:
                if self._active_runs.get(session_key) is run_info:
                    self._active_runs.pop(session_key, None)

    def abort_active_run(self, session_key: str) -> bool:
        """Terminate the in-flight Hermes call for a session.

        Closes the HTTP connection to Hermes's API server, which detects
        the client disconnect and interrupts the agent via
        ``agent.interrupt()`` (api_server.py writes log line "SSE client
        disconnected; interrupted agent task"). Used by
        ``/api/conversation/abort``.

        Returns True if a run was aborted, False if none was active.
        """
        with self._active_runs_lock:
            info = self._active_runs.get(session_key)
        if not info:
            return False
        resp = info.get("response")
        if resp is None:
            # Run is registered but the HTTP request hasn't been issued yet
            # (racing with the start of stream_to_queue). Mark it aborted
            # so the subsequent code path treats it as such.
            info["aborted_by_steer"] = True
            return True
        try:
            resp.close()
        except Exception as e:
            logger.debug(f"Hermes abort_active_run close error (ok): {e}")
        return True

    def send_steer(self, message: str, session_key: str) -> bool:
        """Inject a user message mid-flight by aborting + restarting.

        Hermes has no native steer-at-tool-boundary (OpenClaw does,
        Hermes's REST API is stateless per call). We emulate the user
        experience by:

        1. Closing the in-flight HTTP request (Hermes server interrupts
           the agent; the existing stream_to_queue exception handler
           suppresses its terminal event thanks to ``aborted_by_steer``).
        2. Spawning a fresh stream_to_queue against the SAME event_queue
           so the browser's /api/conversation SSE keeps flowing without
           a visible seam. History already contains the prior user +
           partial-assistant turns; the new call appends the steer
           message and re-asks Hermes.

        Called from ``/api/conversation/steer`` and ``/interject``
        when the classifier chose ``steer`` or ``context`` lane.

        Returns True if steered, False if no active run was found
        (caller should then treat the message as a fresh turn).
        """
        with self._active_runs_lock:
            info = self._active_runs.get(session_key)

        if not info:
            return False

        # Preserve the queue + action list so the replacement run feeds
        # the same browser SSE — the caller's existing connection.
        event_queue = info["event_queue"]
        captured_actions = info["captured_actions"]

        # Flag the outgoing run so its finally-block suppresses text_done.
        info["aborted_by_steer"] = True

        # Close the HTTP connection; hermes server sees SSE client disconnect
        # and fires agent.interrupt() internally.
        resp = info.get("response")
        if resp is not None:
            try:
                resp.close()
            except Exception as e:
                logger.debug(f"Hermes steer close error (ok): {e}")

        # Fire the replacement in a new thread so this handler returns
        # immediately (fire-and-forget contract from interject/steer).
        # stream_to_queue will append `message` to the session history,
        # register itself as the new active run, and emit the final
        # text_done when done.
        def _resume():
            try:
                self.stream_to_queue(
                    event_queue,
                    message,
                    session_key,
                    captured_actions=captured_actions,
                )
            except Exception as e:
                logger.error(f"Hermes steer re-stream failed: {e}")
                event_queue.put({"type": "error", "error": f"Hermes steer failed: {e}"})

        t = threading.Thread(
            target=_resume,
            daemon=True,
            name=f"hermes-steer-{session_key}",
        )
        t.start()

        logger.info(f"Hermes: steered session {session_key} — message injected, run restarted")
        return True

    def reset_session(self, session_key: str) -> None:
        """Clear conversation history for a session."""
        # Kill any in-flight run for this session first so it doesn't
        # keep writing into a queue that will be discarded.
        self.abort_active_run(session_key)
        self._session_history.pop(session_key, None)


class HermesBridgeGateway(GatewayBase):
    """
    Hybrid bridge gateway — OpenClaw remains the primary voice/chat brain,
    but can delegate long-running tasks to Hermes via this gateway.

    This is NOT used as the primary conversation gateway. Instead, OpenClaw
    calls gateway_manager.ask('hermes-bridge', ...) to delegate tasks.

    Use this when the user's framework mode is 'openclaw+hermes'.
    The primary gateway_id in their profile stays 'openclaw'.

    Example delegation from OpenClaw agent:
        "Use the hermes-bridge tool to research competitor pricing"
        -> OpenClaw calls hermes_delegate_task MCP tool
        -> Which internally calls gateway_manager.ask('hermes-bridge', ...)
    """

    gateway_id = "hermes-bridge"
    persistent = False

    def is_configured(self) -> bool:
        return True

    def is_healthy(self) -> bool:
        try:
            resp = requests.get(
                f"{HERMES_BASE_URL}/health",
                headers=_hermes_headers(),
                timeout=5,
            )
            return resp.ok
        except Exception:
            return False

    def stream_to_queue(
        self,
        event_queue: queue.Queue,
        message: str,
        session_key: str,
        captured_actions: Optional[list] = None,
        **kwargs,
    ) -> None:
        """
        Delegate a task to Hermes and stream the response.
        Used for inter-gateway delegation (OpenClaw -> Hermes).

        Streams with tool marker parsing — same as HermesGateway.
        """
        if captured_actions is None:
            captured_actions = []

        start_ms = int(time.time() * 1000)

        try:
            resp = _hermes_post(
                {
                    "model": "hermes-agent",
                    "messages": [{"role": "user", "content": message}],
                    "stream": True,
                },
                session_id=session_key,
                session_key=HERMES_TENANT_SESSION_KEY,
            )

            if not resp.ok:
                event_queue.put({"type": "error", "error": f"Hermes bridge error: {resp.status_code}"})
                return

            handshake_ms = int(time.time() * 1000) - start_ms
            event_queue.put({"type": "handshake", "ms": handshake_ms, "gateway": "hermes-agent"})

            # Stream with tool marker parsing
            processor = _StreamProcessor(event_queue, captured_actions)

            for kind, payload in _iter_sse_content(resp):
                if kind == "content":
                    processor.feed(payload)
                elif kind == "tool_progress":
                    processor.emit_tool_progress(payload)

            full_text, clean_text = processor.finish()

            # Non-streaming fallback
            if not full_text:
                try:
                    body = resp.json()
                    choices = body.get("choices", [])
                    if choices:
                        full_text = choices[0].get("message", {}).get("content", "")
                        if full_text:
                            clean = _strip_tool_markers(full_text)
                            for m in TOOL_MARKER_RE.finditer(full_text):
                                emoji = m.group(1)
                                detail = m.group(2).strip()
                                tool_name = EMOJI_TOOL_MAP.get(emoji, "unknown")
                                act = _make_action_event(emoji, tool_name, detail)
                                event_queue.put(act)
                                captured_actions.append(act["action"])
                            if clean.strip():
                                event_queue.put({"type": "delta", "text": clean})
                            clean_text = clean
                except Exception:
                    pass

            event_queue.put({
                "type": "text_done",
                "response": full_text or "",
                "actions": captured_actions,
            })

        except requests.ConnectionError:
            event_queue.put({
                "type": "error",
                "error": "Hermes bridge: container not reachable",
            })
        except Exception as exc:
            event_queue.put({"type": "error", "error": str(exc)})
