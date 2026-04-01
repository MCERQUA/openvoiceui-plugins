"""
Hermes Agent gateway plugin — routes conversation to Hermes Agent REST API.

Provides two gateway modes:
  - hermes        : Standalone Hermes agent (REST /v1/chat/completions)
  - hermes-bridge : Hybrid mode — OpenClaw primary, Hermes for delegation via MCP

Both modes produce the same event protocol that conversation.py consumes.
Voice works identically in all modes: STT -> text -> gateway -> text -> TTS.
"""

import json
import logging
import os
import queue
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

            # Report handshake latency
            handshake_ms = int(time.time() * 1000) - start_ms
            event_queue.put({"type": "handshake", "ms": handshake_ms})

            full_text = ""

            for line in resp.iter_lines(decode_unicode=True):
                if not line:
                    continue

                # SSE format: "data: {...}"
                if line.startswith("data: "):
                    data_str = line[6:]

                    if data_str.strip() == "[DONE]":
                        break

                    try:
                        chunk = json.loads(data_str)
                        choices = chunk.get("choices", [])
                        if choices:
                            delta = choices[0].get("delta", {})
                            content = delta.get("content")
                            if content:
                                full_text += content
                                event_queue.put({"type": "delta", "text": content})
                    except json.JSONDecodeError:
                        logger.warning(f"Hermes: unparseable SSE chunk: {data_str[:100]}")
                        continue

            # If no streaming, try non-streaming response
            if not full_text:
                try:
                    body = resp.json()
                    choices = body.get("choices", [])
                    if choices:
                        full_text = choices[0].get("message", {}).get("content", "")
                        if full_text:
                            event_queue.put({"type": "delta", "text": full_text})
                except Exception:
                    pass

            if not full_text:
                full_text = ""
                logger.warning(f"Hermes: empty response for session {session_key}")

            # Store assistant response in history
            history.append({"role": "assistant", "content": full_text})

            event_queue.put({
                "type": "text_done",
                "response": full_text,
                "actions": captured_actions,
            })

        except requests.Timeout:
            logger.error(f"Hermes: timeout after {HERMES_TIMEOUT}s for session {session_key}")
            event_queue.put({"type": "error", "error": "Hermes Agent timed out"})

        except requests.ConnectionError:
            logger.error(f"Hermes: connection refused — is hermes container running?")
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
            event_queue.put({"type": "handshake", "ms": handshake_ms})

            full_text = ""
            for line in resp.iter_lines(decode_unicode=True):
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
                            full_text += content
                            event_queue.put({"type": "delta", "text": content})
                except json.JSONDecodeError:
                    continue

            # Try non-streaming fallback
            if not full_text:
                try:
                    body = resp.json()
                    choices = body.get("choices", [])
                    if choices:
                        full_text = choices[0].get("message", {}).get("content", "")
                        if full_text:
                            event_queue.put({"type": "delta", "text": full_text})
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
