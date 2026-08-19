"""
Legacy browser launcher. Prefer `npm run electron` for the native window.
"""

import os
import sys
import threading
import webbrowser
from time import sleep

from app import app


def run_server():
    port = int(os.environ.get('PORT', 5000))
    app.run(host='127.0.0.1', port=port, debug=False, use_reloader=False, threaded=True)


def open_browser():
    sleep(1.5)
    webbrowser.open('http://127.0.0.1:5000/')


if __name__ == '__main__':
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()
    open_browser()
    try:
        while True:
            sleep(1)
    except KeyboardInterrupt:
        sys.exit(0)
