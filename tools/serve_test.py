"""パソコンのブラウザで画面を確かめるためのサーバー。py tools/serve_test.py 8765
index.html に mock.js を差し込む（www のファイルは変えない）"""
import base64
import http.server
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).parent.parent / "www"
MOCK = Path(__file__).parent / "mock.js"
PREVIEW = Path(__file__).parent.parent / "test" / "fixtures" / "clinic_preview.jpg"


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/frame":  # 撮影用：ブラウザの最小幅より狭い画面を枠の中で描く
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)["q"][0]
            data = f'<!doctype html><body style="margin:0"><iframe src="/{q}" style="border:0;width:440px;height:956px;display:block"></iframe>'.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if p in ("/", "/index.html"):
            preview = base64.b64encode(PREVIEW.read_bytes()).decode()
            body = (ROOT / "index.html").read_text(encoding="utf-8").replace(
                '<script src="core.js">', f"<script>window.__receiptPreview=\"{preview}\";{MOCK.read_text(encoding='utf-8')}</script>\n<script src=\"core.js\">")
            data = body.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8765), H).serve_forever()
