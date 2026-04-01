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
