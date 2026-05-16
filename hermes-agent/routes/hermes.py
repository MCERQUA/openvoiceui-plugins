"""
Hermes Agent plugin routes — API endpoints for managing Hermes capabilities.

Provides:
  /api/hermes/status    — Container health, uptime, stats
  /api/hermes/skills    — List auto-generated skills
  /api/hermes/memory    — Search FTS5 memory across sessions
  /api/hermes/tasks     — List/create autonomous tasks
  /api/hermes/tasks/<id> — Get task status and result
  /api/hermes/schedule  — List/create natural language cron jobs
  /api/hermes/mode      — Get/set framework mode
"""

import json
import logging
import os

import requests
from flask import Blueprint, jsonify, request

logger = logging.getLogger(__name__)

hermes_bp = Blueprint("hermes_bp", __name__)

HERMES_HOST = os.getenv("HERMES_HOST", "hermes")
HERMES_PORT = os.getenv("HERMES_PORT", "18790")
HERMES_BASE_URL = f"http://{HERMES_HOST}:{HERMES_PORT}"
HERMES_TIMEOUT = 30

# Path to framework mode file (persisted on server volume)
MODE_FILE = "/app/runtime/hermes-mode.json"


def _hermes_get(path, timeout=HERMES_TIMEOUT):
    """Helper: GET request to Hermes API."""
    try:
        resp = requests.get(f"{HERMES_BASE_URL}{path}", timeout=timeout)
        return resp.json() if resp.ok else None, resp.status_code
    except requests.ConnectionError:
        return None, 503
    except Exception as e:
        logger.error(f"Hermes API error: {e}")
        return None, 500


def _hermes_post(path, data=None, timeout=HERMES_TIMEOUT):
    """Helper: POST request to Hermes API."""
    try:
        resp = requests.post(
            f"{HERMES_BASE_URL}{path}",
            json=data,
            timeout=timeout,
        )
        return resp.json() if resp.ok else None, resp.status_code
    except requests.ConnectionError:
        return None, 503
    except Exception as e:
        logger.error(f"Hermes API error: {e}")
        return None, 500


# ── Status ──────────────────────────────────────────────────────────────


@hermes_bp.route("/api/hermes/status", methods=["GET"])
def hermes_status():
    """Check if Hermes container is running and healthy."""
    try:
        resp = requests.get(f"{HERMES_BASE_URL}/health", timeout=5)
        if resp.ok:
            data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
            return jsonify({
                "status": "running",
                "healthy": True,
                "hermes_version": data.get("version", "unknown"),
                "uptime": data.get("uptime"),
                "skills_count": data.get("skills_count"),
                "memory_entries": data.get("memory_entries"),
            })
        return jsonify({"status": "unhealthy", "healthy": False, "code": resp.status_code})
    except requests.ConnectionError:
        return jsonify({"status": "stopped", "healthy": False, "error": "Container not reachable"}), 503
    except Exception as e:
        return jsonify({"status": "error", "healthy": False, "error": str(e)}), 500


# ── Skills ──────────────────────────────────────────────────────────────


@hermes_bp.route("/api/hermes/skills", methods=["GET"])
def list_skills():
    """List Hermes auto-generated skills."""
    data, code = _hermes_get("/api/skills")
    if data is None:
        return jsonify({
            "skills": [],
            "error": "Hermes not reachable" if code == 503 else "Failed to fetch skills",
        }), code
    return jsonify(data)


@hermes_bp.route("/api/hermes/skills/<skill_id>/run", methods=["POST"])
def run_skill(skill_id):
    """Execute a specific learned skill."""
    body = request.get_json(silent=True) or {}
    data, code = _hermes_post(f"/api/skills/{skill_id}/run", data=body, timeout=120)
    if data is None:
        return jsonify({"error": "Failed to run skill"}), code
    return jsonify(data)


# ── Memory ──────────────────────────────────────────────────────────────


@hermes_bp.route("/api/hermes/memory/search", methods=["POST"])
def search_memory():
    """Search Hermes FTS5 memory across all sessions."""
    body = request.get_json(silent=True) or {}
    query = body.get("query", "")
    if not query:
        return jsonify({"error": "query is required"}), 400

    data, code = _hermes_post("/api/memory/search", data={"query": query, "limit": body.get("limit", 20)})
    if data is None:
        return jsonify({
            "results": [],
            "error": "Hermes not reachable" if code == 503 else "Search failed",
        }), code
    return jsonify(data)


@hermes_bp.route("/api/hermes/memory/stats", methods=["GET"])
def memory_stats():
    """Get memory statistics."""
    data, code = _hermes_get("/api/memory/stats")
    if data is None:
        return jsonify({"error": "Cannot fetch memory stats"}), code
    return jsonify(data)


# ── Tasks ───────────────────────────────────────────────────────────────


@hermes_bp.route("/api/hermes/tasks", methods=["GET"])
def list_tasks():
    """List running and completed autonomous tasks."""
    data, code = _hermes_get("/api/tasks")
    if data is None:
        return jsonify({"tasks": [], "error": "Hermes not reachable" if code == 503 else "Failed"}), code
    return jsonify(data)


@hermes_bp.route("/api/hermes/tasks", methods=["POST"])
def create_task():
    """Delegate a new autonomous task to Hermes."""
    body = request.get_json(silent=True) or {}
    task_description = body.get("task", body.get("description", ""))
    if not task_description:
        return jsonify({"error": "task description is required"}), 400

    data, code = _hermes_post("/api/tasks", data={"task": task_description}, timeout=60)
    if data is None:
        return jsonify({"error": "Failed to create task"}), code
    return jsonify(data), 201


@hermes_bp.route("/api/hermes/tasks/<task_id>", methods=["GET"])
def get_task(task_id):
    """Get status and result of a specific task."""
    data, code = _hermes_get(f"/api/tasks/{task_id}")
    if data is None:
        return jsonify({"error": "Task not found or Hermes not reachable"}), code
    return jsonify(data)


# ── Schedule ────────────────────────────────────────────────────────────


@hermes_bp.route("/api/hermes/schedule", methods=["GET"])
def list_schedules():
    """List natural language cron jobs."""
    data, code = _hermes_get("/api/schedule")
    if data is None:
        return jsonify({"schedules": []}), code
    return jsonify(data)


@hermes_bp.route("/api/hermes/schedule", methods=["POST"])
def create_schedule():
    """Create a new natural language scheduled task."""
    body = request.get_json(silent=True) or {}
    description = body.get("description", "")
    if not description:
        return jsonify({"error": "description is required"}), 400

    data, code = _hermes_post("/api/schedule", data=body, timeout=30)
    if data is None:
        return jsonify({"error": "Failed to create schedule"}), code
    return jsonify(data), 201


# ── Framework Mode ──────────────────────────────────────────────────────


@hermes_bp.route("/api/hermes/mode", methods=["GET"])
def get_mode():
    """Get current framework mode."""
    try:
        if os.path.isfile(MODE_FILE):
            with open(MODE_FILE) as f:
                data = json.load(f)
            return jsonify(data)
    except Exception:
        pass
    return jsonify({"mode": "openclaw", "available_modes": ["openclaw", "hermes", "openclaw+hermes"]})


@hermes_bp.route("/api/hermes/mode", methods=["PUT"])
def set_mode():
    """Set framework mode. Requires container restart to take effect."""
    body = request.get_json(silent=True) or {}
    mode = body.get("mode", "")
    valid_modes = ["openclaw", "hermes", "openclaw+hermes"]
    if mode not in valid_modes:
        return jsonify({"error": f"Invalid mode. Must be one of: {valid_modes}"}), 400

    data = {"mode": mode, "available_modes": valid_modes}
    os.makedirs(os.path.dirname(MODE_FILE), exist_ok=True)
    with open(MODE_FILE, "w") as f:
        json.dump(data, f, indent=2)

    return jsonify({
        "ok": True,
        "mode": mode,
        "note": "Restart the container for the new mode to take effect",
    })


# ---------------------------------------------------------------------------
# Mid-flight message control — hermes's own pipeline (no shared routing)
# ---------------------------------------------------------------------------
# These endpoints call the HermesGateway instance directly, bypassing
# gateway_manager's default routing. The frontend should call these when
# hermes is the active gateway for the session. See gateway.py for the
# abort_active_run / send_steer semantics.


def _get_hermes_gateway():
    """Fetch the registered HermesGateway instance from gateway_manager.

    Returns the gateway or None if hermes isn't registered / configured.
    """
    try:
        from services.gateway_manager import gateway_manager
    except Exception as e:
        logger.error(f"hermes routes: cannot import gateway_manager: {e}")
        return None
    gw = gateway_manager.get("hermes") or gateway_manager.get("hermes-agent")
    if gw is None or not gw.is_configured():
        return None
    return gw


def _resolve_session_key():
    """Resolve the voice-session key the same way core conversation does."""
    try:
        from routes.conversation import get_voice_session_key
        return get_voice_session_key()
    except Exception:
        return "default"


@hermes_bp.route("/api/hermes/abort", methods=["POST"])
def hermes_abort():
    """Abort the in-flight Hermes agent call for this session.

    Hermes-side equivalent of /api/conversation/abort but scoped to
    hermes only: closes the HTTP connection to the hermes /v1/chat/completions
    call. Hermes's api_server detects the disconnect and fires
    agent.interrupt() internally.

    Request body (all optional):
        source (str) — caller label for logging

    Returns: { ok: true, aborted: bool }
    """
    body = request.get_json(silent=True) or {}
    source = body.get("source", "unknown")

    gw = _get_hermes_gateway()
    if gw is None:
        return jsonify({"ok": False, "error": "Hermes gateway not available"}), 503

    session_key = _resolve_session_key()
    aborted = False
    if hasattr(gw, "abort_active_run"):
        aborted = bool(gw.abort_active_run(session_key))

    logger.info(
        f"### HERMES ABORT session={session_key} aborted={aborted} source={source}"
    )
    return jsonify({"ok": True, "aborted": aborted})


@hermes_bp.route("/api/hermes/steer", methods=["POST"])
def hermes_steer():
    """Inject a user message into the active Hermes run (fire-and-forget).

    Hermes-side equivalent of /api/conversation/steer. Calls
    HermesGateway.send_steer which aborts the in-flight HTTP call and
    respawns stream_to_queue against the same browser SSE event queue —
    so the user experience is continuous: the agent "pivots" mid-thought
    without a visible seam.

    Request body:
        message (str)  — the user's text to inject
        source  (str)  — caller label for logging

    Returns: { ok: true, steered: bool }
    """
    body = request.get_json(silent=True) or {}
    message = (body.get("message") or "").strip()
    source = body.get("source", "unknown")

    if not message:
        return jsonify({"ok": False, "error": "No message provided"}), 400
    if len(message) > 4000:
        return jsonify({"ok": False, "error": "Message too long"}), 400

    gw = _get_hermes_gateway()
    if gw is None:
        return jsonify({"ok": False, "error": "Hermes gateway not available"}), 503

    session_key = _resolve_session_key()
    steered = False
    if hasattr(gw, "send_steer"):
        steered = bool(gw.send_steer(message, session_key))

    logger.info(
        f"### HERMES STEER session={session_key} steered={steered} "
        f"source={source} text={message!r}"
    )

    # Log the steer message as a user turn for transcript preservation.
    try:
        from routes.conversation import log_conversation
        log_conversation("user", message, session_id="default")
    except Exception:
        pass

    return jsonify({"ok": True, "steered": steered})


@hermes_bp.route("/api/hermes/interject", methods=["POST"])
def hermes_interject():
    """Smart message routing during an active Hermes run.

    Hermes-side equivalent of /api/conversation/interject. Classifies
    the incoming message the same way core conversation does and routes
    each lane to hermes's own primitives:

      context   → steer (hermes has no separate "queue alongside" — we
                  treat both context and steer the same: mid-flight abort
                  + restart with the new message appended to history)
      steer     → steer
      fast_lane → fire an independent hermes call with the message alone
                  (no in-flight interference; response streamed separately)

    The fast_lane path spawns a parallel hermes call with a fresh session
    key so it doesn't pollute the primary session's history.

    Request body:
        message (str) — user text
        source  (str) — caller label for logging

    Returns: { ok: true, lane: str, action: str }
    """
    body = request.get_json(silent=True) or {}
    message = (body.get("message") or "").strip()
    source = body.get("source", "unknown")

    if not message:
        return jsonify({"ok": False, "error": "No message provided"}), 400
    if len(message) > 4000:
        return jsonify({"ok": False, "error": "Message too long"}), 400

    gw = _get_hermes_gateway()
    if gw is None:
        return jsonify({"ok": False, "error": "Hermes gateway not available"}), 503

    try:
        from routes.message_classifier import classify_message
        lane = classify_message(message, agent_busy=True)
    except Exception:
        lane = "steer"  # safe default

    session_key = _resolve_session_key()

    if lane in ("context", "steer"):
        # Hermes collapses "queue alongside" into steer since it has no
        # native collect-mode. The user message still lands and the agent
        # pivots at the next chunk boundary.
        steered = False
        if hasattr(gw, "send_steer"):
            steered = bool(gw.send_steer(message, session_key))
        action = "steered" if steered else "missed"
        logger.info(
            f"### HERMES INTERJECT [{lane}] session={session_key} "
            f"action={action} source={source} text={message!r}"
        )

        try:
            from routes.conversation import log_conversation
            log_conversation("user", message, session_id="default")
        except Exception:
            pass

        return jsonify({"ok": True, "lane": lane, "action": action})

    # fast_lane — spawn parallel hermes call on a separate session key.
    # The response is collected with a short timeout and returned inline
    # (frontend can TTS it immediately).
    import threading
    import time as _time
    from queue import Queue as _Q

    fast_session_key = "hermes-fast-lane"
    fq: _Q = _Q()

    def _fast_run():
        try:
            gw.stream_to_queue(
                fq, message, fast_session_key, captured_actions=None
            )
        except Exception as e:
            logger.error(f"### HERMES FAST LANE error: {e}")
        finally:
            fq.put({"type": "text_done", "response": None})

    threading.Thread(target=_fast_run, daemon=True,
                     name=f"hermes-fast-{fast_session_key}").start()

    fast_text = ""
    fast_start = _time.time()
    while _time.time() - fast_start < 15:
        try:
            ev = fq.get(timeout=1)
            if ev.get("type") == "delta":
                fast_text += ev.get("text", "")
            elif ev.get("type") == "text_done":
                if ev.get("response"):
                    fast_text = ev["response"]
                break
        except Exception:
            continue

    logger.info(
        f"### HERMES INTERJECT [fast_lane] session={fast_session_key} "
        f"source={source} text={message!r} → response={fast_text[:100]!r}"
    )

    try:
        from routes.conversation import log_conversation
        log_conversation("user", message, session_id="default")
    except Exception:
        pass

    return jsonify({
        "ok": True,
        "lane": "fast_lane",
        "action": "fast_lane",
        "response": fast_text,
    })
