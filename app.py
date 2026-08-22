import os
import re
import sys
import hashlib
import shutil
import subprocess
import json
from urllib.parse import urlparse, unquote
from flask import Flask, request, jsonify, send_from_directory, render_template, url_for, send_file, abort, redirect, Response
from werkzeug.utils import secure_filename

ALLOWED_EXTENSIONS = {'mp4', 'mov', 'h264', 'h265', 'ts', 'm4v', 'mkv', 'avi'}
DEFAULT_CONFIG = {
    'ffprobe_path': '',
    'ffmpeg_path': '',
}

QP_NEW_FRAME_RE = re.compile(r'New frame, type:\s*([IPB])', re.IGNORECASE)
QP_ROW_RE = re.compile(r'\]\s+(\d+)\s(.*)$')
QP_HEADER_GAP_RE = re.compile(r'\d\s{3,}\d')

# Currently opened source video (original path; not copied)
current_source_path = None

# Codecs Chromium typically cannot play in <video> — use ffmpeg→canvas preview
HARD_PREVIEW_CODECS = frozenset({
    'prores', 'prores_aw', 'prores_ks', 'prores_lt', 'prores_hq',
    'prores_4444', 'prores_xq', 'prores_vlog',
    'dnxhd', 'dnxhr', 'v210', 'rawvideo', 'yuv4', 'wrapped_avframe',
})


def primary_video_codec(json_data):
    for stream in json_data.get('streams') or []:
        if stream.get('codec_type') == 'video':
            return (stream.get('codec_name') or '').lower()
    return ''


def preview_hint_for_codec(codec):
    if not codec:
        return 'native'
    if codec in HARD_PREVIEW_CODECS or codec.startswith('prores') or codec.startswith('yuv'):
        return 'ffmpeg'
    return 'native'


def media_cache_key(video_path):
    """Stable token for /media/source?v= — busts browser cache between files."""
    if is_http_url(video_path):
        return hashlib.sha256(video_path.encode('utf-8')).hexdigest()[:16]
    try:
        st = os.stat(video_path)
        raw = f'{video_path}|{st.st_mtime_ns}|{st.st_size}'
    except OSError:
        raw = video_path
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]


def local_video_playback_url(video_path):
    return url_for('serve_source', v=media_cache_key(video_path))


def no_store_video_response(payload):
    if hasattr(payload, 'headers'):
        payload.headers['Cache-Control'] = 'no-store'
        return payload
    response = Response(payload)
    response.headers['Cache-Control'] = 'no-store'
    return response


def is_frozen():
    return getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS')


def resource_root():
    """Bundled read-only assets (templates/static) when frozen."""
    if is_frozen():
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


def user_data_dir():
    """Writable app data for analysis logs and config."""
    if sys.platform == 'darwin':
        base = os.path.join(os.path.expanduser('~'), 'Library', 'Application Support', 'VidPlot')
    elif sys.platform == 'win32':
        base = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'VidPlot')
    else:
        base = os.path.join(os.path.expanduser('~'), '.vidplot')
    os.makedirs(base, exist_ok=True)
    return base


ROOT = resource_root()
DATA_DIR = user_data_dir()
UPLOAD_FOLDER = os.path.join(DATA_DIR, 'uploads')  # browser-mode fallback only
OUTPUT_FOLDER = os.path.join(DATA_DIR, 'logs')
CONFIG_PATH = os.path.join(DATA_DIR, 'config.json')

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

app = Flask(
    __name__,
    template_folder=os.path.join(ROOT, 'templates'),
    static_folder=os.path.join(ROOT, 'static'),
)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['OUTPUT_FOLDER'] = OUTPUT_FOLDER
# Set True by serve_desktop.py / Electron so the UI prefers native file paths
app.config['DESKTOP_MODE'] = os.environ.get('VIDPLOT_DESKTOP', '').lower() in ('1', 'true', 'yes')


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def load_config():
    if not os.path.isfile(CONFIG_PATH):
        return dict(DEFAULT_CONFIG)
    try:
        with open(CONFIG_PATH, 'r') as f:
            data = json.load(f)
        return {
            'ffprobe_path': str(data.get('ffprobe_path', '') or ''),
            'ffmpeg_path': str(data.get('ffmpeg_path', '') or ''),
        }
    except (json.JSONDecodeError, OSError):
        return dict(DEFAULT_CONFIG)


def save_config(config):
    with open(CONFIG_PATH, 'w') as f:
        json.dump(config, f, indent=2)


def is_usable_binary(path):
    return bool(path) and os.path.isfile(path) and os.access(path, os.X_OK)


def common_bin_dirs():
    """Locations macOS/Windows GUI apps often miss because PATH is minimal."""
    home = os.path.expanduser('~')
    dirs = [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/opt/local/bin',
        '/usr/bin',
        os.path.join(home, '.local', 'bin'),
    ]
    if sys.platform == 'win32':
        pf = os.environ.get('ProgramFiles', r'C:\Program Files')
        pf86 = os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')
        local = os.environ.get('LOCALAPPDATA', os.path.join(home, 'AppData', 'Local'))
        dirs.extend([
            os.path.join(pf, 'ffmpeg', 'bin'),
            os.path.join(pf86, 'ffmpeg', 'bin'),
            os.path.join(local, 'Microsoft', 'WinGet', 'Links'),
            r'C:\ffmpeg\bin',
        ])
    return dirs


def ensure_extended_path():
    """Prepend common binary dirs so packaged apps can find Homebrew/etc tools."""
    current = os.environ.get('PATH', '')
    parts = [p for p in current.split(os.pathsep) if p]
    for directory in reversed(common_bin_dirs()):
        if directory and os.path.isdir(directory) and directory not in parts:
            parts.insert(0, directory)
    os.environ['PATH'] = os.pathsep.join(parts)


def find_binary(name):
    """Find an executable even when the GUI app PATH lacks Homebrew."""
    ensure_extended_path()
    found = shutil.which(name)
    if found:
        return found

    candidates = []
    for directory in common_bin_dirs():
        candidates.append(os.path.join(directory, name))
        if sys.platform == 'win32':
            candidates.append(os.path.join(directory, f'{name}.exe'))

    for candidate in candidates:
        if is_usable_binary(candidate):
            return candidate

    # Last resort on macOS/Linux: ask a login shell (has user PATH/Homebrew)
    if sys.platform != 'win32':
        try:
            shell = os.environ.get('SHELL') or '/bin/zsh'
            result = subprocess.run(
                [shell, '-lc', f'command -v {name}'],
                check=False,
                capture_output=True,
                text=True,
                timeout=3,
            )
            path = (result.stdout or '').strip().splitlines()
            if path and is_usable_binary(path[-1]):
                return path[-1]
        except (OSError, subprocess.SubprocessError):
            pass

    return None


def resolve_binary(configured_path, fallback_name):
    path = (configured_path or '').strip()
    if path:
        expanded = os.path.expanduser(path)
        if is_usable_binary(expanded):
            return expanded
        raise FileNotFoundError(
            f"Configured {fallback_name} path is invalid or not executable: {path}"
        )
    found = find_binary(fallback_name)
    if found:
        return found
    raise FileNotFoundError(
        f"{fallback_name} not found. Install FFmpeg or set the path in Configure."
    )


def is_http_url(value):
    if not value or not isinstance(value, str):
        return False
    try:
        parsed = urlparse(value.strip())
    except ValueError:
        return False
    return parsed.scheme in ('http', 'https') and bool(parsed.netloc)


def source_display_name(source):
    """Best-effort filename for UI / analysis cache keys."""
    if is_http_url(source):
        path = unquote(urlparse(source).path or '')
        name = os.path.basename(path.rstrip('/'))
        if name:
            return name
        host = urlparse(source).netloc or 'remote'
        return f'{host}-video'
    return os.path.basename(source)


def validate_video_path(path):
    """Accept a local filesystem path or an http(s) URL for ffprobe/ffmpeg."""
    if not path or not isinstance(path, str):
        raise ValueError('No file path or URL provided')
    raw = path.strip()
    if is_http_url(raw):
        # Extensionless CDN URLs are fine — ffprobe validates the media
        parsed = urlparse(raw)
        if parsed.scheme not in ('http', 'https'):
            raise ValueError('Only http:// and https:// URLs are supported')
        return raw

    resolved = os.path.abspath(os.path.expanduser(raw))
    if not os.path.isfile(resolved):
        raise ValueError(f'File not found: {path}')
    if not allowed_file(resolved):
        raise ValueError('Unsupported file type')
    if not os.access(resolved, os.R_OK):
        raise ValueError('File is not readable')
    return resolved


def ffprobe_input_args(source):
    """Extra ffprobe flags for network inputs."""
    if is_http_url(source):
        return [
            '-rw_timeout', '30000000',  # 30s I/O timeout (microseconds)
            '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
        ]
    return []


def friendly_ffprobe_error(stderr, filename=''):
    """Turn ffprobe stderr into a short UI-facing message."""
    text = (stderr or '').strip()
    lower = text.lower()
    name = filename or 'This file'

    if 'moov atom not found' in lower:
        return (
            f'{name} looks incomplete or corrupted (missing moov atom). '
            'Re-export or re-download the video and try again.'
        )
    if 'invalid data found when processing input' in lower:
        return f'{name} could not be read as a valid video. It may be truncated or corrupted.'
    if 'permission denied' in lower:
        return f'Permission denied reading {name}.'
    if 'no such file' in lower:
        return f'File not found: {name}'
    if '404' in lower or 'not found' in lower:
        return f'URL not found (404): {name}'
    if '403' in lower or 'forbidden' in lower:
        return f'Access denied fetching URL: {name}'
    if 'connection refused' in lower:
        return f'Connection refused for {name}.'
    if 'timed out' in lower or 'timeout' in lower or 'error number -138' in lower:
        return f'Timed out reading {name}. Check the URL or your network.'
    if 'ssl' in lower or 'certificate' in lower:
        return f'TLS/SSL error while fetching {name}.'
    if 'http' in lower and ('error' in lower or 'fail' in lower):
        return f'Could not fetch URL: {name}'

    # Prefer the last meaningful stderr line over the raw CalledProcessError text
    for line in reversed(text.splitlines()):
        line = line.strip()
        if line and not line.startswith('{'):
            return line
    return text or 'ffprobe failed while reading the video'


def run_ffprobe(cmd, filename=''):
    """Run ffprobe and raise ValueError with a readable message on failure."""
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise ValueError(friendly_ffprobe_error(proc.stderr, filename))
    return proc


def parse_qp_cells(blob):
    """Parse ffmpeg `%2d`-packed QP cells from one debug row."""
    if not blob:
        return []
    # Column header rows use wide spacing between values — skip those
    if QP_HEADER_GAP_RE.search(blob):
        return []
    values = []
    text = blob.rstrip('\n')
    for i in range(0, len(text) - 1, 2):
        cell = text[i:i + 2]
        if cell.strip().isdigit():
            values.append(int(cell))
    return values


def extract_mean_qp_per_frame(ffmpeg_bin, video_path):
    """Decode with ffmpeg QP debug and return mean QP per output frame.

    H.264 (and codecs that print the same `New frame` / QP grid logs) work.
    HEVC and others often omit QP maps — returns [] and analysis continues.
    """
    cmd = [
        ffmpeg_bin,
        '-hide_banner',
        '-nostats',
        *ffprobe_input_args(video_path),
        '-debug:v', 'qp',
        '-i', video_path,
        '-an',
        '-v', '48',
        '-f', 'null',
        '-',
    ]
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except OSError:
        return []

    means = []
    current_qps = []
    in_frame = False

    try:
        assert proc.stderr is not None
        for line in proc.stderr:
            if QP_NEW_FRAME_RE.search(line):
                if in_frame:
                    if current_qps:
                        means.append(round(sum(current_qps) / len(current_qps), 2))
                    else:
                        means.append(None)
                current_qps = []
                in_frame = True
                continue

            match = QP_ROW_RE.search(line)
            if not match:
                continue
            values = parse_qp_cells(match.group(2))
            if values:
                current_qps.extend(values)

        if in_frame:
            if current_qps:
                means.append(round(sum(current_qps) / len(current_qps), 2))
            else:
                means.append(None)

        proc.wait(timeout=3600)
    except (OSError, subprocess.SubprocessError, ValueError):
        try:
            proc.kill()
        except OSError:
            pass
        return []

    # Only keep results when we actually got some QP samples
    if not any(v is not None for v in means):
        return []
    return means


def attach_mean_qp(frames, mean_qps):
    """Write mean_qp onto each ffprobe frame dict (best-effort index align)."""
    if not frames:
        return
    if not mean_qps:
        for frame in frames:
            frame['mean_qp'] = None
        return
    for index, frame in enumerate(frames):
        frame['mean_qp'] = mean_qps[index] if index < len(mean_qps) else None


def analysis_json_paths(video_path):
    """Return (json_filename, output_json_path) for a source path or URL."""
    filename = source_display_name(video_path)
    stem = secure_filename(os.path.splitext(filename)[0]) or 'video'
    path_hash = hashlib.sha1(video_path.encode('utf-8')).hexdigest()[:10]
    json_filename = f'{stem}_{path_hash}_data.json'
    return json_filename, os.path.join(OUTPUT_FOLDER, json_filename)


def ffmpeg_is_available(config=None):
    config = config if config is not None else load_config()
    try:
        resolve_binary(config.get('ffmpeg_path'), 'ffmpeg')
        return True
    except FileNotFoundError:
        return False


def analyze_video_file(video_path):
    """Fast open: container + streams only. Frames/QP are follow-up API calls."""
    global current_source_path

    video_path = validate_video_path(video_path)
    filename = source_display_name(video_path)
    remote = is_http_url(video_path)
    json_filename, output_json_path = analysis_json_paths(video_path)

    config = load_config()
    ffprobe_bin = resolve_binary(config.get('ffprobe_path'), 'ffprobe')
    ffmpeg_available = ffmpeg_is_available(config)

    streams_cmd = [
        ffprobe_bin,
        '-hide_banner',
        '-loglevel', 'error',
        *ffprobe_input_args(video_path),
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        video_path,
    ]

    streams_proc = run_ffprobe(streams_cmd, filename)

    try:
        json_data = json.loads(streams_proc.stdout or '{}')
    except json.JSONDecodeError as exc:
        raise ValueError(f'Invalid ffprobe output for {filename}') from exc

    if not json_data.get('streams') and not json_data.get('format', {}).get('format_name'):
        raise ValueError(
            f'{filename} did not return any streams. '
            'It may be incomplete or an unsupported format.'
        )

    json_data['frames'] = []
    json_data['qp_available'] = False
    json_data['frames_pending'] = True
    json_data['qp_pending'] = ffmpeg_available

    if 'format' not in json_data:
        json_data['format'] = {}
    if remote:
        # Prefer size from the remote format header when present
        remote_size = json_data['format'].get('size')
        try:
            json_data['format']['file_size'] = int(remote_size) if remote_size is not None else None
        except (TypeError, ValueError):
            json_data['format']['file_size'] = None
    else:
        json_data['format']['file_size'] = os.path.getsize(video_path)
    json_data['format']['filename'] = filename
    json_data['format']['source_path'] = video_path
    json_data['format']['is_remote'] = remote

    with open(output_json_path, 'w') as f:
        json.dump(json_data, f)

    current_source_path = video_path
    duration = float(json_data.get('format', {}).get('duration', 0) or 0)
    # Unique ?v= per file so Chromium does not reuse a cached /media/source clip.
    video_url = video_path if remote else local_video_playback_url(video_path)
    preview_hint = preview_hint_for_codec(primary_video_codec(json_data))

    return {
        'message': 'File opened successfully',
        'json_url': url_for('serve_log', filename=json_filename),
        'video_url': video_url,
        'duration': duration,
        'filename': filename,
        'source_path': video_path,
        'is_remote': remote,
        'preview_hint': preview_hint,
        'status': 'opened',
        'frames_pending': True,
        'qp_pending': ffmpeg_available,
        'data': json_data,
    }


def analyze_frames_for_path(video_path):
    """Per-frame size/type probe; merges into the saved analysis JSON."""
    video_path = validate_video_path(video_path)
    filename = source_display_name(video_path)
    config = load_config()
    ffprobe_bin = resolve_binary(config.get('ffprobe_path'), 'ffprobe')
    ffmpeg_available = ffmpeg_is_available(config)

    frames_cmd = [
        ffprobe_bin,
        '-hide_banner',
        '-loglevel', 'error',
        *ffprobe_input_args(video_path),
        '-select_streams', 'v:0',
        '-print_format', 'json',
        '-show_entries', 'frame=pict_type,best_effort_timestamp_time,pkt_pts_time,pkt_dts_time,pkt_size',
        video_path,
    ]
    frames_proc = run_ffprobe(frames_cmd, filename)

    try:
        frames_data = json.loads(frames_proc.stdout or '{}')
    except json.JSONDecodeError as exc:
        raise ValueError(f'Invalid ffprobe frame output for {filename}') from exc

    frames = frames_data.get('frames', [])
    attach_mean_qp(frames, [])

    json_filename, output_json_path = analysis_json_paths(video_path)
    json_data = {}
    if os.path.isfile(output_json_path):
        try:
            with open(output_json_path, 'r') as f:
                json_data = json.load(f)
        except (OSError, json.JSONDecodeError):
            json_data = {}

    json_data['frames'] = frames
    json_data['frames_pending'] = False
    json_data['qp_available'] = False
    json_data['qp_pending'] = ffmpeg_available
    if 'format' not in json_data:
        json_data['format'] = {}
    json_data['format'].setdefault('filename', filename)
    json_data['format']['source_path'] = video_path

    with open(output_json_path, 'w') as f:
        json.dump(json_data, f)

    return {
        'source_path': video_path,
        'frames': frames,
        'frame_count': len(frames),
        'frames_pending': False,
        'qp_pending': ffmpeg_available,
    }


def ffmpeg_input_args(source):
    """Extra ffmpeg flags for network inputs (same idea as ffprobe)."""
    return ffprobe_input_args(source)


# QCTools playback-filter defaults (see bavc/qctools filter graph dump)
# plus FFmpeg codecview for motion vectors / QP map:
# https://trac.ffmpeg.org/wiki/Debug/MacroblocksAndMotionVectors
SCOPE_ORDER = (
    'oscilloscope',
    'waveform',
    'rgbparade',
    'histogram',
    'vectorscope',
    'motion',
    'qpmap',
)

# Filters that must run on decoder-native frames (side data is resolution-tied)
SCOPE_NATIVE_FRAME = frozenset({'motion', 'qpmap'})


def pix_fmt_bit_depth(pix_fmt):
    """Infer component bit depth from an FFmpeg pix_fmt name."""
    if not pix_fmt:
        return 8
    text = str(pix_fmt).lower()
    for bits in (16, 14, 12, 10, 9):
        if f'p{bits}' in text:
            return bits
    return 8


def scope_planar_formats(bit_depth):
    """YUV / RGB planar formats that keep waveform/histogram axis labels accurate."""
    depth = int(bit_depth) if bit_depth else 8
    if depth >= 12:
        return 'yuv420p12le', 'gbrp12le'
    if depth >= 10:
        return 'yuv420p10le', 'gbrp10le'
    if depth >= 9:
        return 'yuv420p9le', 'gbrp9le'
    return 'yuv420p', 'gbrp'


def source_video_bit_depth(video_path):
    """Bit depth for scopes from saved analysis JSON (pix_fmt / bits_per_raw_sample)."""
    try:
        _, json_path = analysis_json_paths(video_path)
    except Exception:
        return 8
    if not os.path.isfile(json_path):
        return 8
    try:
        with open(json_path, 'r', encoding='utf-8') as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return 8
    for stream in data.get('streams') or []:
        if stream.get('codec_type') != 'video':
            continue
        raw = stream.get('bits_per_raw_sample')
        try:
            if raw is not None and str(raw).strip() and str(raw).upper() != 'N/A':
                return max(8, int(raw))
        except (TypeError, ValueError):
            pass
        return pix_fmt_bit_depth(stream.get('pix_fmt'))
    return 8


def scope_filter_chains(bit_depth=8):
    """Build per-analyzer ffmpeg filter strings for the source bit depth."""
    yuv_fmt, rgb_fmt = scope_planar_formats(bit_depth)
    return {
        'oscilloscope': (
            'oscilloscope=x=500000/1000000:y=500000/1000000:'
            's=500000/1000000:t=500000/1000000'
        ),
        'waveform': (
            f'format={yuv_fmt},waveform=intensity=0.1:mode=column:mirror=1:c=1:f=0:'
            'graticule=green:flags=numbers+dots:scale=0'
        ),
        'rgbparade': (
            f'format={rgb_fmt},waveform=filter=lowpass:components=7:display=parade:'
            'mode=column:mirror=1:graticule=green:flags=numbers+dots:scale=0'
        ),
        'histogram': (
            f'format={rgb_fmt},histogram=display_mode=overlay:colors_mode=coloronblack:'
            'level_height=720:scale_height=0:bgopacity=1:fgopacity=0.85:'
            'levels_mode=linear'
        ),
        'vectorscope': (
            f'format={yuv_fmt},vectorscope=i=0.1:mode=3:envelope=0:colorspace=1:'
            'graticule=green:flags=name,'
            'pad=ih*1.77778:ih:(ow-iw)/2:(oh-ih)/2'
        ),
        # Requires -flags2 +export_mvs on decode (see render_scope_jpeg)
        'motion': 'codecview=mv=pf+bf+bb',
        # Requires -export_side_data +venc_params (H.264/VP9).
        'qpmap': 'codecview=qp=1:block=1',
    }


def build_scope_filter_complex(filters, preview_width=960, bit_depth=8):
    """Build a QCTools-style ffmpeg -filter_complex mosaic for selected analyzers.

    Filter strings match QCTools (plus codecview for motion/QP map). Each tile is
    scaled to a shared 16:9 canvas. Motion-vector tiles skip the early scale so
    codecview arrows stay aligned with the decoded frame.
    """
    chains = scope_filter_chains(bit_depth)
    selected = {f for f in filters if f in chains}
    names = [name for name in SCOPE_ORDER if name in selected]
    if not names:
        raise ValueError('No valid scope filters selected')

    n = len(names)
    width = max(320, int(preview_width or 960))
    height = max(180, int(round(width * 9 / 16)))
    # Stretch to the canvas (same idea as QCTools scale2ref). Using
    # force_original_aspect_ratio=decrease left histogram as a thin column.
    fit = f'scale={width}:{height}'
    needs_native = bool(selected & SCOPE_NATIVE_FRAME)

    parts = ['sws_flags=neighbor']
    split_outs = ''.join(f'[x{i}]' for i in range(1, n + 1))
    if needs_native:
        # Keep decoder frame size so exported MVs match the picture
        parts.append(f'[0:v]split={n}{split_outs}')
    else:
        parts.append(f'[0:v]scale={width}:-2[base]')
        parts.append(f'[base]split={n}{split_outs}')

    for i, name in enumerate(names, start=1):
        parts.append(f'[x{i}]{chains[name]},{fit}[y{i}]')

    stack_inputs = ''.join(f'[y{i}]' for i in range(1, n + 1))
    if n == 1:
        parts.append(f'{stack_inputs}format=rgb24[out]')
    else:
        layout = '0_0|w0_0|0_h0|w0_h0|0_h0+h1|w0_h0+h1'
        parts.append(
            f'{stack_inputs}xstack=fill=slategray:inputs={n}:layout={layout},'
            f'format=rgb24[out]'
        )

    return ';'.join(parts), names


def _parse_rate(value, default=25.0):
    """Parse ffprobe rate strings like '25/1' into a float."""
    if value is None:
        return default
    text = str(value).strip()
    if not text or text.upper() == 'N/A':
        return default
    try:
        if '/' in text:
            num, den = text.split('/', 1)
            num_f = float(num)
            den_f = float(den)
            if den_f:
                rate = num_f / den_f
                return rate if rate > 0 else default
        rate = float(text)
        return rate if rate > 0 else default
    except (TypeError, ValueError, ZeroDivisionError):
        return default


def clamp_seek_time(video_path, time_sec):
    """Keep input seeks on a decodable frame.

    HTML5 ``ended`` often sets ``currentTime`` to container duration, which can
    sit past the last video packet PTS. Seeking there makes ffmpeg emit no frame
    and fail the MJPEG encode with a misleading color-range error.
    """
    try:
        t = max(0.0, float(time_sec))
    except (TypeError, ValueError):
        return 0.0

    last_pts = None
    duration = None
    fps = 25.0
    try:
        _, json_path = analysis_json_paths(video_path)
        if os.path.isfile(json_path):
            with open(json_path, 'r', encoding='utf-8') as handle:
                data = json.load(handle)
            for frame in data.get('frames') or []:
                for key in (
                    'best_effort_timestamp_time',
                    'pkt_pts_time',
                    'pts_time',
                ):
                    raw = frame.get(key)
                    if raw is None:
                        continue
                    try:
                        pts = float(raw)
                    except (TypeError, ValueError):
                        continue
                    if last_pts is None or pts > last_pts:
                        last_pts = pts
                    break
            try:
                duration = float((data.get('format') or {}).get('duration'))
            except (TypeError, ValueError):
                duration = None
            for stream in data.get('streams') or []:
                if stream.get('codec_type') != 'video':
                    continue
                fps = _parse_rate(
                    stream.get('avg_frame_rate') or stream.get('r_frame_rate'),
                    default=fps,
                )
                break
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        pass

    if last_pts is not None and last_pts >= 0:
        return min(t, last_pts)
    if duration is not None and duration > 0:
        frame_dur = 1.0 / fps if fps > 0 else 0.04
        return min(t, max(0.0, duration - frame_dur))
    return t


def render_preview_jpeg(video_path, time_sec, max_width=1920):
    """Seek to time_sec and render one JPEG frame for canvas preview."""
    video_path = validate_video_path(video_path)
    config = load_config()
    ffmpeg_bin = resolve_binary(config.get('ffmpeg_path'), 'ffmpeg')
    t = clamp_seek_time(video_path, time_sec)
    try:
        width = max(160, min(3840, int(max_width or 1920)))
    except (TypeError, ValueError):
        width = 1920
    cmd = [
        ffmpeg_bin,
        '-hide_banner',
        '-loglevel', 'error',
        '-ss', f'{t:.3f}',
        *ffmpeg_input_args(video_path),
        '-i', video_path,
        '-an',
        '-vf', f'scale=min({width}\\,iw):-2',
        '-frames:v', '1',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        '-q:v', '3',
        'pipe:1',
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        err = (proc.stderr or b'').decode('utf-8', errors='replace').strip()
        raise ValueError(err or 'Preview frame failed')
    return proc.stdout


def render_scope_jpeg(video_path, time_sec, filters):
    """Seek to time_sec and render selected FFmpeg scope filters as one JPEG."""
    video_path = validate_video_path(video_path)
    config = load_config()
    ffmpeg_bin = resolve_binary(config.get('ffmpeg_path'), 'ffmpeg')
    bit_depth = source_video_bit_depth(video_path)
    filter_complex, used = build_scope_filter_complex(filters, bit_depth=bit_depth)

    t = clamp_seek_time(video_path, time_sec)

    used_set = set(used)
    needs_native = bool(used_set & SCOPE_NATIVE_FRAME)
    needs_mvs = 'motion' in used_set
    needs_venc = 'qpmap' in used_set
    cmd = [
        ffmpeg_bin,
        '-hide_banner',
        '-loglevel', 'error',
    ]
    # Motion arrows need exported MVs; QP map needs VIDEO_ENC_PARAMS (H.264/VP9)
    if needs_mvs:
        cmd.extend(['-flags2', '+export_mvs'])
    if needs_venc:
        cmd.extend(['-export_side_data', '+venc_params'])
    # Seek after open when side-data filters are active so the decoder can export them
    if needs_native:
        cmd.extend([
            *ffmpeg_input_args(video_path),
            '-i', video_path,
            '-ss', f'{t:.3f}',
        ])
    else:
        cmd.extend([
            '-ss', f'{t:.3f}',
            *ffmpeg_input_args(video_path),
            '-i', video_path,
        ])
    cmd.extend([
        '-an',
        '-filter_complex', filter_complex,
        '-map', '[out]',
        '-frames:v', '1',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        '-q:v', '3',
        'pipe:1',
    ])
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        err = (proc.stderr or b'').decode('utf-8', errors='replace').strip()
        raise ValueError(err or 'Scope preview failed')
    return proc.stdout, used


def analyze_qp_for_path(video_path):
    """Run ffmpeg QP pass and merge mean_qp into the saved analysis JSON."""
    video_path = validate_video_path(video_path)

    config = load_config()
    ffmpeg_bin = resolve_binary(config.get('ffmpeg_path'), 'ffmpeg')
    mean_qps = extract_mean_qp_per_frame(ffmpeg_bin, video_path)
    qp_available = bool(mean_qps) and any(v is not None for v in mean_qps)

    _, output_json_path = analysis_json_paths(video_path)
    if os.path.isfile(output_json_path):
        try:
            with open(output_json_path, 'r') as f:
                json_data = json.load(f)
            frames = json_data.get('frames') or []
            attach_mean_qp(frames, mean_qps)
            json_data['frames'] = frames
            json_data['qp_available'] = qp_available
            json_data['qp_pending'] = False
            json_data['frames_pending'] = False
            with open(output_json_path, 'w') as f:
                json.dump(json_data, f)
        except (OSError, json.JSONDecodeError):
            pass

    return {
        'source_path': video_path,
        'mean_qps': mean_qps,
        'qp_available': qp_available,
        'frame_count': len(mean_qps),
    }


@app.route('/static/js/sw.js')
def service_worker():
    response = send_from_directory(os.path.join(app.static_folder, 'js'), 'sw.js')
    response.headers['Service-Worker-Allowed'] = '/'
    return response


@app.route('/media/source')
def serve_source():
    """Stream the currently opened local video, or redirect to a remote URL."""
    if not current_source_path:
        abort(404)
    if is_http_url(current_source_path):
        return redirect(current_source_path)
    if not os.path.isfile(current_source_path):
        abort(404)

    token = request.args.get('v', '')
    expected = media_cache_key(current_source_path)
    if token != expected:
        abort(404)

    return no_store_video_response(send_file(current_source_path))


@app.route('/media/logs/<path:filename>')
def serve_log(filename):
    safe_name = secure_filename(filename)
    path = os.path.join(OUTPUT_FOLDER, safe_name)
    if not os.path.isfile(path):
        abort(404)
    return send_file(path, mimetype='application/json')


@app.route('/')
def index():
    return render_template(
        'index.html',
        desktop_mode=bool(app.config.get('DESKTOP_MODE')),
    )


@app.route('/api/env')
def api_env():
    return jsonify({
        'desktop': bool(app.config.get('DESKTOP_MODE')),
        'frozen': is_frozen(),
    })


@app.route('/api/config', methods=['GET'])
def get_config():
    config = load_config()

    def resolved_for(key, binary_name):
        configured = config.get(key) or ''
        if configured:
            return configured if is_usable_binary(os.path.expanduser(configured)) else None
        return find_binary(binary_name)

    return jsonify({
        'ffprobe_path': config.get('ffprobe_path', ''),
        'ffprobe_resolved': resolved_for('ffprobe_path', 'ffprobe'),
        'ffmpeg_path': config.get('ffmpeg_path', ''),
        'ffmpeg_resolved': resolved_for('ffmpeg_path', 'ffmpeg'),
    })


@app.route('/api/config', methods=['POST'])
def update_config():
    data = request.get_json(silent=True) or {}
    ffprobe_path = str(data.get('ffprobe_path', '') or '').strip()
    ffmpeg_path = str(data.get('ffmpeg_path', '') or '').strip()

    errors = {}
    if ffprobe_path and not is_usable_binary(os.path.expanduser(ffprobe_path)):
        errors['ffprobe_path'] = 'File not found or not executable'
    if ffmpeg_path and not is_usable_binary(os.path.expanduser(ffmpeg_path)):
        errors['ffmpeg_path'] = 'File not found or not executable'

    if errors:
        return jsonify({'error': 'Invalid binary paths', 'fields': errors}), 400

    config = {
        'ffprobe_path': ffprobe_path,
        'ffmpeg_path': ffmpeg_path,
    }
    save_config(config)
    return jsonify({'message': 'Configuration saved', **config})


@app.route('/api/analyze', methods=['POST'])
def analyze_local_path():
    """Analyze a local path or http(s) URL via ffprobe (no server-side copy)."""
    data = request.get_json(silent=True) or {}
    path = data.get('path') or data.get('url')
    try:
        result = analyze_video_file(path)
        return jsonify(result)
    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 400
    except ValueError as e:
        return jsonify({'error': str(e), 'details': str(e)}), 400
    except subprocess.CalledProcessError as e:
        details = friendly_ffprobe_error(e.stderr if e.stderr else str(e))
        return jsonify({'error': 'Error processing video', 'details': details}), 500
    except json.JSONDecodeError as e:
        return jsonify({'error': 'Invalid ffprobe output', 'details': str(e)}), 500


@app.route('/api/analyze-frames', methods=['POST'])
def analyze_frames_route():
    """Deferred per-frame size/type probe (after properties UI is shown)."""
    data = request.get_json(silent=True) or {}
    path = data.get('path') or current_source_path
    try:
        result = analyze_frames_for_path(path)
        return jsonify(result)
    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 400
    except ValueError as e:
        return jsonify({'error': str(e), 'details': str(e)}), 400
    except subprocess.CalledProcessError as e:
        details = friendly_ffprobe_error(e.stderr if e.stderr else str(e))
        return jsonify({'error': 'Frame analysis failed', 'details': details}), 500


@app.route('/api/analyze-qp', methods=['POST'])
def analyze_qp_route():
    """Deferred per-frame Avg QP pass (after the frame graph is ready)."""
    data = request.get_json(silent=True) or {}
    path = data.get('path') or current_source_path
    try:
        result = analyze_qp_for_path(path)
        return jsonify(result)
    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 400
    except ValueError as e:
        return jsonify({'error': str(e), 'details': str(e)}), 400
    except subprocess.CalledProcessError as e:
        details = friendly_ffprobe_error(e.stderr if e.stderr else str(e))
        return jsonify({'error': 'QP analysis failed', 'details': details}), 500


@app.route('/api/preview-frame', methods=['POST'])
def preview_frame_route():
    """Single JPEG frame at a timestamp for ffmpeg→canvas preview."""
    data = request.get_json(silent=True) or {}
    path = data.get('path') or current_source_path
    time_sec = data.get('time', 0)
    width = data.get('width', 1920)
    try:
        jpeg = render_preview_jpeg(path, time_sec, max_width=width)
        response = Response(jpeg, mimetype='image/jpeg')
        response.headers['Cache-Control'] = 'no-store'
        return response
    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 400
    except ValueError as e:
        return jsonify({'error': str(e), 'details': str(e)}), 400
    except Exception as e:
        return jsonify({'error': 'Preview frame failed', 'details': str(e)}), 500


@app.route('/api/scopes', methods=['POST'])
def scopes_preview_route():
    """Render oscilloscope / waveform / histogram / vectorscope at a timestamp."""
    data = request.get_json(silent=True) or {}
    path = data.get('path') or current_source_path
    filters = data.get('filters') or []
    if isinstance(filters, str):
        filters = [filters]
    time_sec = data.get('time', 0)
    try:
        jpeg, used = render_scope_jpeg(path, time_sec, filters)
        response = Response(jpeg, mimetype='image/jpeg')
        response.headers['X-VidPlot-Scopes'] = ','.join(used)
        response.headers['Cache-Control'] = 'no-store'
        return response
    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 400
    except ValueError as e:
        return jsonify({'error': str(e), 'details': str(e)}), 400
    except Exception as e:
        return jsonify({'error': 'Scope preview failed', 'details': str(e)}), 500


@app.route('/upload', methods=['POST'])
def upload_video():
    """Browser fallback: accept an uploaded copy when no native path is available."""
    if 'video' not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files['video']

    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    if not file or not allowed_file(file.filename):
        return jsonify({"error": "Invalid file type"}), 400

    if file.filename is None:
        return jsonify({"error": "Invalid filename"}), 400

    filename = secure_filename(file.filename)
    public_filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(public_filepath)

    try:
        result = analyze_video_file(public_filepath)
        return jsonify(result)
    except FileNotFoundError as e:
        if os.path.isfile(public_filepath):
            os.remove(public_filepath)
        return jsonify({"error": str(e)}), 400
    except ValueError as e:
        if os.path.isfile(public_filepath):
            os.remove(public_filepath)
        return jsonify({"error": str(e), "details": str(e)}), 400
    except subprocess.CalledProcessError as e:
        if os.path.isfile(public_filepath):
            os.remove(public_filepath)
        details = friendly_ffprobe_error(e.stderr if e.stderr else str(e))
        return jsonify({"error": "Error processing video", "details": details}), 500
    except json.JSONDecodeError as e:
        if os.path.isfile(public_filepath):
            os.remove(public_filepath)
        return jsonify({"error": "Invalid ffprobe output", "details": str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)
