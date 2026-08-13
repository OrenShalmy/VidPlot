#!/usr/bin/env python3
"""Build the VidPlot desktop app with PyInstaller.

Usage:
    python3 -m venv .venv
    source .venv/bin/activate        # Windows: .venv\\Scripts\\activate
    pip install -r requirements.txt
    python build_desktop.py
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
        print('  python3 -m venv .venv')
        print('  source .venv/bin/activate')
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

    if sys.platform == 'darwin':
        app_path = os.path.join(root, 'dist', 'VidPlot.app')
        print(f'\nBuilt: {app_path}')
        print('Launch with: open dist/VidPlot.app')
    elif sys.platform == 'win32':
        exe_path = os.path.join(root, 'dist', 'VidPlot', 'VidPlot.exe')
        print(f'\nBuilt: {exe_path}')
    else:
        bin_path = os.path.join(root, 'dist', 'VidPlot', 'VidPlot')
        print(f'\nBuilt: {bin_path}')

    print('\nDev (no build): python desktop.py')


if __name__ == '__main__':
    main()
