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


def _strip_tool_markers(text: str) -> str:
    """Remove all tool marker backtick spans from text, including surrounding newlines."""
    # Remove the marker itself
    cleaned = TOOL_MARKER_RE.sub("", text)
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
    Yield content strings from a streaming SSE response.

    Expected format per line:
        data: {"choices":[{"delta":{"content":"text"}}]}
    Final line:
        data: [DONE]
    """
    for line in response.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        data_str = line[6:]
        if data_str.strip() == "[DONE]":
            break
        try:
            chunk = json.loads(data_str)
            choices = chunk.get("choices", [])
            if choices:
                content = choices[0].get("delta", {}).get("content")
                if content:
                    yield content
        except json.JSONDecodeError:
            continue


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

        try:
            resp = requests.post(
                HERMES_API_URL,
                json={
                    "model": "hermes-agent",
                    "messages": history,
                    "stream": True,
                },
                stream=True,
                timeout=HERMES_TIMEOUT,
                headers={"Content-Type": "application/json"},
            )

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

            for content in _iter_sse_content(resp):
                processor.feed(content)

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

            # Store assistant response in history
            history.append({"role": "assistant", "content": full_text or ""})

            event_queue.put({
                "type": "text_done",
                "response": full_text or "",
                "actions": captured_actions,
            })

        except requests.Timeout:
            logger.error(f"Hermes: timeout after {HERMES_TIMEOUT}s for session {session_key}")
            event_queue.put({"type": "error", "error": "Hermes Agent timed out"})

        except requests.ConnectionError:
            logger.error("Hermes: connection refused — is hermes container running?")
            event_queue.put({
                "type": "error",
                "error": "Cannot connect to Hermes Agent. The container may not be running.",
            })

        except Exception as exc:
            logger.error(f"Hermes: unexpected error: {exc}")
            event_queue.put({"type": "error", "error": str(exc)})

    def reset_session(self, session_key: str) -> None:
        """Clear conversation history for a session."""
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
            resp = requests.get(f"{HERMES_BASE_URL}/health", timeout=5)
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
            resp = requests.post(
                HERMES_API_URL,
                json={
                    "model": "hermes-agent",
                    "messages": [{"role": "user", "content": message}],
                    "stream": True,
                },
                stream=True,
                timeout=HERMES_TIMEOUT,
                headers={"Content-Type": "application/json"},
            )

            if not resp.ok:
                event_queue.put({"type": "error", "error": f"Hermes bridge error: {resp.status_code}"})
                return

            handshake_ms = int(time.time() * 1000) - start_ms
            event_queue.put({"type": "handshake", "ms": handshake_ms, "gateway": "hermes-agent"})

            # Stream with tool marker parsing
            processor = _StreamProcessor(event_queue, captured_actions)

            for content in _iter_sse_content(resp):
                processor.feed(content)

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
