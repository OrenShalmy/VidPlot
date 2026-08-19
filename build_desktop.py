#!/usr/bin/env python3
"""Build the VidPlot analysis sidecar with PyInstaller (used inside Electron).

Usage:
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    python build_desktop.py

Then package the window:
    npm install
    npm run dist
"""

import os
import subprocess
import sys


def main():
    root = os.path.dirname(os.path.abspath(__file__))
    os.chdir(root)
    spec = os.path.join(root, 'vidplot.spec')

    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print('PyInstaller not found. Create a venv and install requirements:')
        print('  python3 -m venv venv')
        print('  source venv/bin/activate')
        print('  pip install -r requirements.txt')
        sys.exit(1)

    cmd = [
        sys.executable, '-m', 'PyInstaller',
        spec,
        '--noconfirm',
        '--clean',
    ]
    print('Running:', ' '.join(cmd))
    result = subprocess.run(cmd)
    if result.returncode != 0:
        sys.exit(result.returncode)

    sidecar = os.path.join(root, 'dist', 'vidplot-server')
    exe_name = 'VidPlotServer.exe' if sys.platform == 'win32' else 'VidPlotServer'
    exe_path = os.path.join(sidecar, exe_name)
    if not os.path.isfile(exe_path):
        print(f'Expected sidecar missing: {exe_path}', file=sys.stderr)
        sys.exit(1)

    print(f'\nSidecar: {exe_path}')
    print('Package Electron with: npm run dist')
    print('Dev (no build): npm run electron')


if __name__ == '__main__':
    main()
