# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the VidPlot analysis sidecar (no GUI).

Electron is the window; this binary is extraResources/vidplot-server.
"""

import os
import sys

block_cipher = None

datas = [
    ('templates', 'templates'),
    ('static/css', 'static/css'),
    ('static/js', 'static/js'),
    ('static/vendor', 'static/vendor'),
    ('static/manifest.json', 'static'),
]

if os.path.isdir('static/icons'):
    datas.append(('static/icons', 'static/icons'))

hiddenimports = [
    'flask',
    'jinja2',
    'werkzeug',
    'werkzeug.security',
    'email.mime.text',
    'waitress',
    'app',
]

a = Analysis(
    ['serve_desktop.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['webview', 'pythonnet', 'clr'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

if sys.platform == 'win32':
    _exe_icon = 'static/icons/VidPlot.ico'
else:
    _exe_icon = None
if _exe_icon and not os.path.isfile(_exe_icon):
    _exe_icon = None

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='VidPlotServer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=_exe_icon,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='vidplot-server',
)
