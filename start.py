from __future__ import annotations

import argparse
import errno
import functools
import os
import posixpath
import shutil
import socket
import subprocess
import sys
import urllib.parse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


# The server listens on every network interface so other devices on the same
# Wi-Fi/LAN can connect. Point the public hostname to this PC's IP with DNS
# or each visitor's hosts file.
HOST = "0.0.0.0"
PORT = 80
PUBLIC_HOSTNAME = "ksjblog.host"
BASE_PATH = "/main/"

ROOT_DIR = Path(__file__).resolve().parent
DIST_DIR = ROOT_DIR / "dist"
NODE_MODULES_DIR = ROOT_DIR / "node_modules"


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


class WebsiteHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str | None = None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def do_GET(self) -> None:
        self._serve_or_redirect()

    def do_HEAD(self) -> None:
        self._serve_or_redirect()

    def translate_path(self, path: str) -> str:
        parsed_path = urllib.parse.urlsplit(path).path
        parsed_path = urllib.parse.unquote(parsed_path)

        if parsed_path.startswith(BASE_PATH):
            parsed_path = parsed_path[len(BASE_PATH) :]

        parsed_path = posixpath.normpath(parsed_path)
        parts = [
            part
            for part in parsed_path.split("/")
            if part and part not in (os.curdir, os.pardir)
        ]

        resolved_path = Path(self.directory)
        for part in parts:
            resolved_path /= part
        return str(resolved_path)

    def log_message(self, format: str, *args) -> None:
        sys.stdout.write("%s - %s\n" % (self.log_date_time_string(), format % args))

    def _serve_or_redirect(self) -> None:
        parsed_path = urllib.parse.urlsplit(self.path).path

        base_without_slash = BASE_PATH.rstrip("/") or "/"

        if parsed_path in ("", "/"):
            self._redirect(base_without_slash)
            return

        if parsed_path == base_without_slash:
            self.path = BASE_PATH

        target_path = Path(self.translate_path(self.path))
        if parsed_path.startswith(BASE_PATH) and not target_path.exists():
            # Vite/React single page apps need index.html for client-side routes.
            if not Path(parsed_path).suffix:
                self.path = BASE_PATH

        super().do_GET() if self.command == "GET" else super().do_HEAD()

    def _redirect(self, location: str) -> None:
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build and serve this website.")
    parser.add_argument(
        "--host",
        default=HOST,
        help=f"Address to bind to. Default: {HOST}",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=PORT,
        help=f"Port to use. Default: {PORT}",
    )
    parser.add_argument(
        "--public-hostname",
        default=PUBLIC_HOSTNAME,
        help=f"Hostname to show in the site URL. Default: {PUBLIC_HOSTNAME}",
    )
    parser.add_argument(
        "--no-build",
        action="store_true",
        help="Skip npm install/build and serve the existing dist folder.",
    )
    parser.add_argument(
        "--no-install",
        action="store_true",
        help="Do not run npm install automatically when node_modules is missing.",
    )
    return parser.parse_args()


def run_command(command: list[str]) -> None:
    printable = " ".join(command)
    print(f"\n> {printable}")
    subprocess.run(command, cwd=ROOT_DIR, check=True)


def prepare_dist(no_build: bool, no_install: bool) -> None:
    if no_build:
        ensure_dist_exists()
        return

    npm = shutil.which("npm")
    if npm is None:
        print("npm was not found. Serving the existing dist folder instead.")
        ensure_dist_exists()
        return

    if not NODE_MODULES_DIR.exists() and not no_install:
        run_command([npm, "install"])

    run_command([npm, "run", "build"])
    ensure_dist_exists()


def ensure_dist_exists() -> None:
    index_file = DIST_DIR / "index.html"
    if not index_file.exists():
        raise SystemExit(
            "dist/index.html was not found. Run `npm install` and `npm run build` first."
        )


def get_lan_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        pass

    try:
        candidate = socket.gethostbyname(socket.gethostname())
    except OSError:
        return None

    if candidate.startswith("127."):
        return None
    return candidate


def make_server(host: str, preferred_port: int) -> tuple[ReusableThreadingHTTPServer, int]:
    handler = functools.partial(WebsiteHandler, directory=str(DIST_DIR))

    for port in range(preferred_port, preferred_port + 20):
        try:
            return ReusableThreadingHTTPServer((host, port), handler), port
        except OSError as exc:
            if exc.errno in (errno.EADDRINUSE, 10048):
                continue
            raise

    raise SystemExit(
        f"No available port found from {preferred_port} to {preferred_port + 19}."
    )


def get_public_url(public_hostname: str, port: int) -> str:
    path = BASE_PATH.rstrip("/") or "/"
    port_part = "" if port == 80 else f":{port}"
    return f"http://{public_hostname}{port_part}{path}"


def print_addresses(host: str, port: int, public_hostname: str) -> None:
    site_url = get_public_url(public_hostname, port)

    print("\n" + "=" * 60)
    print("WEBSITE SERVER IS RUNNING")
    print("=" * 60)
    print(f"Site URL: {site_url}")
    print(f"Server: listening on port {port}")
    print()
    print(f"DNS/hosts must point {public_hostname} to this PC.")

    print("=" * 60)
    print("If another device cannot connect, allow Python through Windows Firewall.")
    print("Press Ctrl+C to stop the server.\n")


def main() -> None:
    args = parse_args()
    prepare_dist(args.no_build, args.no_install)
    server, port = make_server(args.host, args.port)
    print_addresses(args.host, port, args.public_hostname)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
