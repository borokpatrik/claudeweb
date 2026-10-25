"""Tiny local server for the depth tool (Python stdlib only).

Serves the alapko/ folder statically and accepts
    POST /save?name=<file>.png
writing the request body ONLY into alapko/assets/depth/.

Usage (from anywhere):  python alapko/tools/save_server.py [port]
Then open http://127.0.0.1:47911/tools/depth.html
"""
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # alapko/
DEPTH_DIR = os.path.join(ROOT, "assets", "depth")
NAME_RE = re.compile(r"^[a-z0-9-]+\.png$")
MAX_BYTES = 20 * 1024 * 1024
PNG_SIG = b"\x89PNG\r\n\x1a\n"


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _reply(self, code, text):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/save":
            return self._reply(404, "not found")
        name = parse_qs(url.query).get("name", [""])[0]
        if not NAME_RE.fullmatch(name):
            return self._reply(400, "bad name")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._reply(400, "bad length")
        if length <= 0 or length > MAX_BYTES:
            return self._reply(413, "bad size")
        data = self.rfile.read(length)
        if not data.startswith(PNG_SIG):
            return self._reply(400, "not a png")
        path = os.path.realpath(os.path.join(DEPTH_DIR, name))
        if os.path.dirname(path) != os.path.realpath(DEPTH_DIR):
            return self._reply(400, "bad path")
        os.makedirs(DEPTH_DIR, exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
        self.log_message("saved %s (%d bytes)", name, len(data))
        return self._reply(200, "ok " + name)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 47911
    httpd = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=ROOT))
    print(f"serving {ROOT} on http://127.0.0.1:{port}/  (depth -> {DEPTH_DIR})", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
