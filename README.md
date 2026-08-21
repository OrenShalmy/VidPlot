# VidPlot

Local video frame analyzer for inspecting per-frame size, frame type (I/P/B), timestamps (DTS/PTS), and average QP. Drop a clip, scrub with JKL / frame-step keys, and explore the bitrate graph next to a video preview.

![VidPlot with full-height tracks & properties, video preview, and frame graph aligned below](docs/screenshot.png)

## Features

- Drag-and-drop, native file open (desktop), or HTTP(S) URL (ffprobe/ffmpeg stream the remote file)
- Staged analysis: streams/properties → frame chart → QP (when available)
- Per-frame hover: frame number, timecode, DTS, PTS, size, type, Avg QP
- JKL shuttle, Space play/pause, `,` / `.` (or `<` / `>`) frame step, arrow keys ±1s
- Desktop app: Electron window + bundled Python analysis server

## Prerequisites

- Python 3.10+ and Node.js 20+ for development
- [FFmpeg](https://ffmpeg.org/) (provides `ffprobe` and `ffmpeg` on your `PATH`)

### Install FFmpeg

**macOS**

```bash
brew install ffmpeg
```

**Ubuntu / Debian**

```bash
sudo apt update
sudo apt install ffmpeg
```

**Windows**

Download from the [FFmpeg site](https://ffmpeg.org/download.html) and add it to your system `PATH`.

## Setup

```bash
git clone https://github.com/Oren-Beamr/VidPlot.git
cd VidPlot

python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

pip install -r requirements.txt
npm install
```

npm 11+ may skip Electron’s binary download until you allow it:

```bash
npm install-scripts approve electron
```

If you see `Electron failed to install correctly`:

```bash
npm install-scripts approve electron
rm -rf node_modules/electron
npm install
```

## Run

### Desktop (recommended)

```bash
npm run electron
```

Uses the project `venv/` automatically. Override with `VIDPLOT_PYTHON=/path/to/python`.

Open files in the **VidPlot window**. Cursor’s Simple Browser can talk to the same Flask server but has no native picker; it falls back to a normal file chooser (upload copy).

### Browser / Flask

```bash
python app.py
```

Then open [http://localhost:5000](http://localhost:5000).

## Build a desktop app

Packaged builds ship Electron plus a PyInstaller **VidPlotServer** sidecar (no pywebview / .NET). FFmpeg is still expected on `PATH` (or set in Configure).

### Locally

```bash
python build_desktop.py
npm run dist
```

Output zips land in `dist-electron/`.

### macOS first launch (downloaded from GitHub)

Release builds are **not notarized**. Chrome/Safari quarantine the zip and macOS may say **“VidPlot.app is damaged”** — the app is fine; Gatekeeper is blocking an unsigned download.

**Steps that work:**

1. Extract `VidPlot.app` from the zip.
2. **Control-click** (or right-click) `VidPlot.app` → **Open** → **Open** again.
3. If macOS still refuses: **System Settings → Privacy & Security** → scroll down → **Open Anyway**.

After that one-time approval, double-click launches normally.

**Alternatives if Terminal is easier:**

Copy to `/Applications` without quarantine xattrs (macOS often blocks `xattr -d` on the `.app` with `Operation not permitted`):

```bash
cp -R -X ~/Downloads/VidPlot.app /Applications/VidPlot.app
open /Applications/VidPlot.app
```

Or clear quarantine on the **zip** before extracting:

```bash
xattr -d com.apple.quarantine ~/Downloads/VidPlot-macOS-arm64.zip
```

Do **not** use `xattr -cr` or `-dr` on the `.app` — recursing into a signed bundle fails with hundreds of `Operation not permitted` errors.

To ship builds that open without this step, add an Apple Developer ID certificate and notarization in CI.

### CI (macOS + Windows + Linux)

GitHub Actions builds desktop zips on macOS, Windows, and Ubuntu runners.

- **Tag a release** (builds all platforms and attaches assets):

  ```bash
  git tag v1.2.0
  git push vidplot v1.2.0
  ```

- **Manual run:** Actions → **Build desktop** → Run workflow  
  Optionally check “Upload build zips to a GitHub Release” and set a tag like `v1.2.0`.

Artifacts:

- `VidPlot-macOS-arm64.zip` — Apple Silicon `.app`
- `VidPlot-Windows-x64.zip` — Intel/AMD64 Electron app (`VidPlot.exe`)
- `VidPlot-Windows-arm64.zip` — Windows on ARM Electron app
- `VidPlot-Linux-x64.zip` — Ubuntu/Debian **x86_64** (`uname -m` → `x86_64`)
- `VidPlot-Linux-arm64.zip` — Ubuntu/Debian **ARM64** (`uname -m` → `aarch64`)

Unpack the matching zip and run `./VidPlot` (keep the whole folder intact).

```bash
chmod +x VidPlot
./VidPlot
```

Linux still needs FFmpeg on `PATH` (`sudo apt install ffmpeg`). Packaged Linux builds disable Chromium’s SUID sandbox automatically (required for zip installs). For an older build, use `./VidPlot --no-sandbox`.

## Usage

1. Open a video (drag-and-drop, file picker, or paste an `http://` / `https://` URL).
2. Wait for properties, then the frame graph (QP fills in when supported).
3. Hover bars for frame details; use keyboard shortcuts to scrub and shuttle.

Remote URLs are probed in place (no download copy). Preview playback uses the URL directly in the video element, so the host must allow media access from the app.

## License

See repository for license details.
