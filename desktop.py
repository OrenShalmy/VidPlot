"""
VidPlot desktop launcher (pywebview + local Flask server).

Dev:
    python desktop.py

Build:
    python build_desktop.py
"""

import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from threading import Semaphore

import webview
from waitress import serve
from webview.dom import DOMEventHandler

from app import app, ensure_extended_path

# GUI-launched .app bundles often have a tiny PATH (no Homebrew).
ensure_extended_path()

# Tell the Flask UI this is the native desktop shell (no upload fallback)
app.config['DESKTOP_MODE'] = True
os.environ['VIDPLOT_DESKTOP'] = '1'

VIDEO_EXTENSIONS = ('mp4', 'mov', 'm4v', 'mkv', 'avi', 'ts', 'h264', 'h265')


class Api:
    """JS bridge for native file picking (analyzes original path, no copy)."""

    def __init__(self):
        self._window = None

    def set_window(self, window):
        self._window = window

    def is_desktop(self):
        return True

    def open_video(self):
        """Open a native file picker and return the selected path.

        On macOS we drive NSOpenPanel ourselves with URLs() — pywebview's
        create_file_dialog still uses the deprecated filenames() API, which can
        throw after the user picks a file and leave the JS promise hanging
        forever (UI stuck on the idle drop screen).
        """
        if sys.platform == 'darwin':
            return self._open_video_macos()
        return self._open_video_webview()

    def _open_video_macos(self):
        try:
            import AppKit
            from PyObjCTools import AppHelper
        except ImportError as exc:
            print('open_video: AppKit unavailable:', exc, file=sys.stderr)
            return self._open_video_webview()

        state = {'path': None, 'error': None}
        done = Semaphore(0)

        def show_panel():
            try:
                panel = AppKit.NSOpenPanel.openPanel()
                panel.setCanChooseFiles_(True)
                panel.setCanChooseDirectories_(False)
                panel.setAllowsMultipleSelection_(False)
                panel.setAllowedFileTypes_(list(VIDEO_EXTENSIONS))
                panel.setMessage_('Choose a video to analyze')
                if panel.runModal() == AppKit.NSFileHandlingPanelOKButton:
                    urls = panel.URLs()
                    if urls and len(urls) > 0:
                        # Prefer URL path — works with modern / sandboxed panels
                        state['path'] = str(urls[0].path())
            except Exception as exc:
                state['error'] = str(exc)
                print('open_video dialog failed:', exc, file=sys.stderr)
            finally:
                done.release()

        AppHelper.callAfter(show_panel)
        if not done.acquire(timeout=600):
            raise TimeoutError('File picker timed out')
        if state['error']:
            raise RuntimeError(state['error'])
        return state['path']

    def _open_video_webview(self):
        if not self._window:
            return None
        try:
            dialog = getattr(webview, 'FileDialog', None)
            dialog_type = dialog.OPEN if dialog is not None else webview.OPEN_DIALOG
            result = self._window.create_file_dialog(
                dialog_type,
                allow_multiple=False,
                file_types=(
                    'Video Files (*.mp4;*.mov;*.m4v;*.mkv;*.avi;*.ts)',
                    'All files (*.*)',
                ),
            )
        except TypeError:
            result = self._window.create_file_dialog(webview.OPEN_DIALOG)
        except Exception as exc:
            print('open_video dialog failed:', exc, file=sys.stderr)
            raise
        if not result:
            return None
        path = result[0]
        return path if isinstance(path, str) else str(path)


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def wait_for_server(url, timeout=15.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:
                if response.status < 500:
                    return True
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(0.1)
    return False


def start_server(port):
    serve(app, host='127.0.0.1', port=port, threads=6, _quiet=True)


def bind_native_drop(window):
    """Enable drag-and-drop of real filesystem paths (no file-picker fallback).

    Plain HTML File objects in the webview have no .path. pywebview only
    injects pywebviewFullPath when a Python DOM 'drop' listener is registered
    (that bumps _dnd_state['num_listeners'] so the native layer captures URLs).
    """

    def on_drop(event):
        files = (event.get('dataTransfer') or {}).get('files') or []
        path = None
        for file_info in files:
            path = file_info.get('pywebviewFullPath') or file_info.get('path')
            if path:
                break
        if not path:
            return
        # Hand off to the existing JS analyze flow
        window.evaluate_js(
            f'window.vidplotOpenPath && window.vidplotOpenPath({json.dumps(path)})'
        )

    for selector in ('#dropArea', '#loadNewVideoBtn'):
        target = window.dom.get_element(selector)
        if not target:
            continue
        # preventDefault on dragover is required for drop to fire
        target.on('dragover', DOMEventHandler(lambda _e: None, prevent_default=True))
        target.on(
            'drop',
            DOMEventHandler(on_drop, prevent_default=True, stop_propagation=True),
        )


def main():
    port = find_free_port()
    url = f'http://127.0.0.1:{port}/'
    api = Api()

    server_thread = threading.Thread(target=start_server, args=(port,), daemon=True)
    server_thread.start()

    if not wait_for_server(url):
        print('VidPlot failed to start the local server.', file=sys.stderr)
        sys.exit(1)

    window = webview.create_window(
        title='VidPlot',
        url=url,
        js_api=api,
        width=1400,
        height=900,
        min_size=(960, 640),
        background_color='#181c24',
        text_select=True,
    )
    api.set_window(window)
    window.events.loaded += lambda: bind_native_drop(window)
    webview.start(debug=False)


if __name__ == '__main__':
    main()
