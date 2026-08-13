# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for VidPlot desktop app."""

import sys
from PyInstaller.utils.hooks import collect_all

block_cipher = None

datas = [
    ('templates', 'templates'),
    ('static/css', 'static/css'),
    ('static/js', 'static/js'),
    ('static/vendor', 'static/vendor'),
    ('static/manifest.json', 'static'),
]

# Optional icons if present
import os
if os.path.isdir('static/icons'):
    datas.append(('static/icons', 'static/icons'))

# Collect pywebview backend resources
webview_datas, webview_binaries, webview_hiddenimports = collect_all('webview')

hiddenimports = list(webview_hiddenimports) + [
    'flask',
    'jinja2',
    'werkzeug',
    'werkzeug.security',
    'email.mime.text',
    'waitress',
    'app',
]

if sys.platform == 'darwin':
    hiddenimports += [
        'objc',
        'WebKit',
        'Cocoa',
        'Quartz',
        'CoreFoundation',
        'Foundation',
        'AppKit',
    ]
elif sys.platform == 'win32':
    hiddenimports += [
        'clr',
        'pythonnet',
    ]

a = Analysis(
    ['desktop.py'],
    pathex=[],
    binaries=webview_binaries,
    datas=datas + webview_datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

if sys.platform == 'darwin':
    _exe_icon = 'static/icons/VidPlot.icns'
elif sys.platform == 'win32':
    _exe_icon = 'static/icons/VidPlot.ico'
else:
    _exe_icon = 'static/icons/icon-512x512.png'
if not os.path.isfile(_exe_icon):
    _exe_icon = None

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='VidPlot',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # no terminal window
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
    upx=True,
    upx_exclude=[],
    name='VidPlot',
)

# macOS .app bundle
if sys.platform == 'darwin':
    app = BUNDLE(
        coll,
        name='VidPlot.app',
        icon='static/icons/VidPlot.icns' if os.path.isfile('static/icons/VidPlot.icns') else _exe_icon,
        bundle_identifier='com.vidplot.app',
        info_plist={
            'NSPrincipalClass': 'NSApplication',
            'NSHighResolutionCapable': True,
            'CFBundleName': 'VidPlot',
            'CFBundleDisplayName': 'VidPlot',
            'CFBundleShortVersionString': '1.0.0',
            'CFBundleVersion': '1.0.0',
            'CFBundleIconFile': 'VidPlot',
        },
    )
