#!/usr/bin/env python3
"""Start Monochromium's Vite server and open it in the default browser."""

from __future__ import annotations

import shutil
import json
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
SAVE_DIRECTORY = ROOT / "save_data"
SAVE_FILE = SAVE_DIRECTORY / "monochromium_save.json"
SAVE_BACKUP_FILE = SAVE_DIRECTORY / "monochromium_save.backup.json"
MAX_SAVE_BYTES = 16 * 1024 * 1024
SAVE_LOCK = threading.RLock()


def open_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((HOST, 0))
        return int(sock.getsockname()[1])


def wait_until_ready(url: str, process: subprocess.Popen[bytes]) -> None:
    for _ in range(120):
        if process.poll() is not None:
            raise RuntimeError("The game server exited before it became ready.")
        try:
            with urllib.request.urlopen(url, timeout=0.25) as response:
                if response.status < 500:
                    return
        except Exception:
            time.sleep(0.1)
    raise TimeoutError("The game server did not become ready in time.")


def fresh_save() -> dict[str, Any]:
    return {"version": 1, "meta": None, "customModes": [], "customEnemies": [], "customMaps": [], "creatorFolders": {"version": 1, "modes": [], "enemies": [], "maps": [], "assignments": {"modes": {}, "enemies": {}, "maps": {}}}}


def read_save() -> tuple[bool, dict[str, Any]]:
    with SAVE_LOCK:
        if not SAVE_FILE.exists():
            return False, fresh_save()
        try:
            parsed = json.loads(SAVE_FILE.read_text(encoding="utf-8"))
            if not isinstance(parsed, dict):
                raise ValueError("Save root must be an object")
            return True, {
                "version": 1,
                "meta": parsed.get("meta"),
                "customModes": parsed.get("customModes", []),
                "customEnemies": parsed.get("customEnemies", []),
                "customMaps": parsed.get("customMaps", []),
                "creatorFolders": parsed.get("creatorFolders", fresh_save()["creatorFolders"]),
            }
        except (OSError, ValueError, json.JSONDecodeError):
            return False, fresh_save()


def write_save(payload: dict[str, Any]) -> None:
    normalized = {
        "version": 1,
        "meta": payload.get("meta"),
        "customModes": payload.get("customModes", []),
        "customEnemies": payload.get("customEnemies", []),
        "customMaps": payload.get("customMaps", []),
        "creatorFolders": payload.get("creatorFolders", fresh_save()["creatorFolders"]),
    }
    SAVE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    temporary = SAVE_DIRECTORY / "monochromium_save.tmp.json"
    with SAVE_LOCK:
        if SAVE_FILE.exists():
            shutil.copy2(SAVE_FILE, SAVE_BACKUP_FILE)
        temporary.write_text(json.dumps(normalized, indent=2, ensure_ascii=False), encoding="utf-8")
        temporary.replace(SAVE_FILE)


def write_save_section(key: str, value: object) -> None:
    with SAVE_LOCK:
        _, current = read_save()
        current[key] = value
        write_save(current)


def make_save_handler(allowed_origin: str) -> type[BaseHTTPRequestHandler]:
    class SaveHandler(BaseHTTPRequestHandler):
        server_version = "MonochromiumSave/1.0"

        def log_message(self, format: str, *args: object) -> None:
            return

        def _origin_allowed(self) -> bool:
            origin = self.headers.get("Origin")
            return origin is None or origin == allowed_origin

        def _headers(self, status: int = 200) -> None:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

        def _json(self, payload: object, status: int = 200) -> None:
            self._headers(status)
            self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))

        def _read_json(self) -> object:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_SAVE_BYTES:
                raise ValueError("Invalid save size")
            return json.loads(self.rfile.read(length).decode("utf-8"))

        def do_OPTIONS(self) -> None:
            if not self._origin_allowed():
                self._json({"error": "Origin rejected"}, 403)
                return
            self._headers(204)

        def do_GET(self) -> None:
            if not self._origin_allowed() or self.path != "/api/save":
                self._json({"error": "Not found"}, 404)
                return
            exists, data = read_save()
            self._json({"exists": exists, "data": data})

        def do_PUT(self) -> None:
            if not self._origin_allowed():
                self._json({"error": "Origin rejected"}, 403)
                return
            try:
                incoming = self._read_json()
                if self.path == "/api/save":
                    if not isinstance(incoming, dict):
                        raise ValueError("Save bundle must be an object")
                    write_save(incoming)
                elif self.path in ("/api/save/meta", "/api/save/custom-modes", "/api/save/custom-enemies", "/api/save/custom-maps", "/api/save/creator-folders"):
                    key = "meta" if self.path.endswith("/meta") else "customEnemies" if self.path.endswith("/custom-enemies") else "customMaps" if self.path.endswith("/custom-maps") else "creatorFolders" if self.path.endswith("/creator-folders") else "customModes"
                    write_save_section(key, incoming)
                else:
                    self._json({"error": "Not found"}, 404)
                    return
                self._json({"ok": True})
            except (OSError, UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
                self._json({"error": str(exc)}, 400)

    return SaveHandler


def main() -> int:
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if npm is None:
        print("Node.js/npm is required. Install Node.js 20.19+ and try again.")
        return 1

    if not (ROOT / "node_modules").exists():
        print("Installing game dependencies (first launch only)…")
        installed = subprocess.run([npm, "install"], cwd=ROOT, check=False)
        if installed.returncode != 0:
            return installed.returncode

    port = open_port()
    url = f"http://{HOST}:{port}"
    api_port = open_port()
    save_server = ThreadingHTTPServer((HOST, api_port), make_save_handler(url))
    save_thread = threading.Thread(target=save_server.serve_forever, name="monochromium-save-api", daemon=True)
    save_thread.start()
    launch_url = f"{url}?saveApi={api_port}"
    print(f"Starting MONOCHROMIUM at {url}")
    print(f"Save file: {SAVE_FILE}")
    process: subprocess.Popen[bytes] | None = None

    try:
        process = subprocess.Popen(
            [npm, "run", "dev", "--", "--port", str(port), "--strictPort"],
            cwd=ROOT,
        )
        wait_until_ready(url, process)
        webbrowser.open(launch_url)
        print("Game opened. Press Ctrl+C here to stop the server.")
        return process.wait()
    except KeyboardInterrupt:
        print("\nShutting down MONOCHROMIUM…")
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
        return 0
    except Exception as exc:
        print(f"Launch failed: {exc}")
        if process is not None:
            process.terminate()
        return 1
    finally:
        save_server.shutdown()
        save_server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
