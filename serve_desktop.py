"""Start the Flask analysis server in desktop mode (no GUI).

Used by the Electron shell (dev: python; packaged: VidPlotServer sidecar).

    python serve_desktop.py
    VIDPLOT_PORT=8765 python serve_desktop.py
"""

import os
import socket
import sys

from waitress import serve

from app import app, ensure_extended_path

ensure_extended_path()
app.config['DESKTOP_MODE'] = True
os.environ['VIDPLOT_DESKTOP'] = '1'


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    raw = os.environ.get('VIDPLOT_PORT', '').strip()
    try:
        port = int(raw) if raw else 0
    except ValueError:
        port = 0
    if port <= 0:
        port = find_free_port()

    url = f'http://127.0.0.1:{port}/'
    # Electron watches this line on stdout
    print(f'VIDPLOT_READY {port} {url}', flush=True)
    serve(app, host='127.0.0.1', port=port, threads=6, _quiet=True)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
