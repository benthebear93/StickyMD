#!/usr/bin/env python3
"""Serve VM test artifacts and print text reports posted by a guest."""

from __future__ import annotations

import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class BridgeHandler(SimpleHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(400, "Invalid Content-Length")
            return

        raw_payload = self.rfile.read(length)
        if self.path.startswith("/upload/"):
            filename = Path(self.path).name
            if not filename or filename in {".", ".."}:
                self.send_error(400, "Invalid upload name")
                return
            target = Path("/tmp") / f"stickymd-upload-{filename}"
            target.write_bytes(raw_payload)
            print(f"Saved StickyMD guest upload to {target}", flush=True)
            self.send_response(204)
            self.end_headers()
            return

        payload = raw_payload.decode("utf-8", errors="replace")
        print("--- StickyMD guest report ---", flush=True)
        print(payload.rstrip(), flush=True)
        print("--- End guest report ---", flush=True)
        self.send_response(204)
        self.end_headers()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, default=Path("/tmp"))
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8765)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    handler = functools.partial(BridgeHandler, directory=str(args.directory))
    server = ThreadingHTTPServer((args.bind, args.port), handler)
    print(
        f"StickyMD VM bridge listening on {args.bind}:{args.port} "
        f"from {args.directory}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
