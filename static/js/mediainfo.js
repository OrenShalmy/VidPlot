function updatemediaInfo(jsonData) {
  const mediaInfo = document.getElementById('mediaInfo');
  const streamTree = document.getElementById('streamTree');
  if (!mediaInfo || !streamTree) return;

  window.vidplotJsonData = jsonData;

  const filename = window.vidplotCurrentFilename
    || jsonData?.format?.filename
    || 'Unknown File';

  function detectGOP(frames) {
    const iFrameIndices = (frames || [])
      .map((frame, index) => (frame.pict_type === 'I' ? index : -1))
      .filter((index) => index !== -1);

    if (iFrameIndices.length < 2) return 'N/A';

    const distances = [];
    for (let i = 1; i < iFrameIndices.length; i++) {
      distances.push(iFrameIndices[i] - iFrameIndices[i - 1]);
    }

    const frequencyMap = {};
    let maxFreq = 0;
    let mostCommonGOP = 0;
    distances.forEach((distance) => {
      frequencyMap[distance] = (frequencyMap[distance] || 0) + 1;
      if (frequencyMap[distance] > maxFreq) {
        maxFreq = frequencyMap[distance];
        mostCommonGOP = distance;
      }
    });

    const consistency = maxFreq / distances.length;
    return consistency > 0.5 ? mostCommonGOP : 'Variable';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatBitrate(bps) {
    const n = parseInt(bps, 10);
    if (!n) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} Mb/s`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(2)} kb/s`;
    return `${n} b/s`;
  }

  function formatDuration(seconds) {
    const n = parseFloat(seconds);
    if (!isFinite(n)) return '—';
    return `${n.toFixed(3)} s`;
  }

  function formatFps(rate) {
    if (!rate || rate === '0/0') return '—';
    if (String(rate).includes('/')) {
      const [a, b] = String(rate).split('/').map(Number);
      if (!b) return String(rate);
      return `${(a / b).toFixed(3)} fps`;
    }
    const n = parseFloat(rate);
    return isFinite(n) ? `${n.toFixed(3)} fps` : String(rate);
  }

  function parseRatio(value) {
    if (!value || value === '0:1' || value === 'N/A') return null;
    if (String(value).includes(':')) {
      const [a, b] = String(value).split(':').map(Number);
      if (!b || !isFinite(a) || !isFinite(b)) return null;
      return a / b;
    }
    const n = parseFloat(value);
    return isFinite(n) && n > 0 ? n : null;
  }

  function gcd(a, b) {
    let x = Math.abs(Math.round(a));
    let y = Math.abs(Math.round(b));
    while (y) {
      const t = y;
      y = x % y;
      x = t;
    }
    return x || 1;
  }

  function formatAspectRatio(stream) {
    const width = parseInt(stream.width, 10);
    const height = parseInt(stream.height, 10);
    let ratio = parseRatio(stream.display_aspect_ratio);

    if (!ratio && width && height) {
      const sar = parseRatio(stream.sample_aspect_ratio) || 1;
      ratio = (width * sar) / height;
    }
    if (!ratio || !isFinite(ratio) || ratio <= 0) return null;

    const known = [
      { label: '1:1', value: 1 },
      { label: '5:4', value: 5 / 4 },
      { label: '4:3', value: 4 / 3 },
      { label: '3:2', value: 3 / 2 },
      { label: '16:10', value: 16 / 10 },
      { label: '16:9', value: 16 / 9 },
      { label: '2:1', value: 2 },
      { label: '21:9', value: 21 / 9 },
      { label: '2.35:1', value: 2.35 },
      { label: '2.39:1', value: 2.39 },
    ];

    let label = null;
    let bestDiff = Infinity;
    known.forEach((item) => {
      const diff = Math.abs(ratio - item.value);
      if (diff < bestDiff && diff / item.value < 0.02) {
        bestDiff = diff;
        label = item.label;
      }
    });

    if (!label && width && height) {
      const sar = parseRatio(stream.sample_aspect_ratio) || 1;
      const aw = Math.round(width * sar);
      const ah = height;
      const d = gcd(aw, ah);
      label = `${Math.round(aw / d)}:${Math.round(ah / d)}`;
    }
    if (!label) label = `${ratio.toFixed(2)}:1`;

    return `${label} (${ratio.toFixed(2)})`;
  }

  function fpsNumber(rate) {
    if (!rate || rate === '0/0') return null;
    if (String(rate).includes('/')) {
      const [a, b] = String(rate).split('/').map(Number);
      if (!b) return null;
      const n = a / b;
      return isFinite(n) && n > 0 ? n : null;
    }
    const n = parseFloat(rate);
    return isFinite(n) && n > 0 ? n : null;
  }

  function formatBitsPerPixel(stream) {
    const width = parseInt(stream.width, 10);
    const height = parseInt(stream.height, 10);
    const bitrate = parseInt(stream.bit_rate, 10)
      || parseInt(jsonData.format?.bit_rate, 10);
    const fps = fpsNumber(stream.avg_frame_rate)
      || fpsNumber(stream.r_frame_rate);

    if (!width || !height || !bitrate || !fps) return null;

    const bpp = bitrate / (width * height * fps);
    if (!isFinite(bpp) || bpp <= 0) return null;

    let quality;
    if (bpp >= 0.10) quality = 'High quality';
    else if (bpp >= 0.07) quality = 'OK quality';
    else quality = 'Low quality';

    return `${bpp.toFixed(3)} (${quality})`;
  }

  function streamLabel(stream, typeIndex) {
    const codec = stream.codec_name || stream.codec_tag_string || 'unknown';
    const lang = stream.tags?.language || stream.tags?.LANGUAGE;
    const title = stream.tags?.title || stream.tags?.handler_name;
    const parts = [`${typeIndex + 1}`, codec];
    if (lang && lang !== 'und') parts.push(lang);
    if (title) parts.push(title);
    if (stream.codec_type === 'video' && stream.width && stream.height) {
      parts.push(`${stream.width}×${stream.height}`);
    }
    if (stream.codec_type === 'audio' && stream.channels) {
      parts.push(`${stream.channels}ch`);
    }
    return parts.join(' · ');
  }

  function groupStreams(streams) {
    const order = ['video', 'audio', 'subtitle', 'data', 'attachment'];
    const labels = {
      video: 'Video',
      audio: 'Audio',
      subtitle: 'Captions',
      data: 'Data',
      attachment: 'Attachments',
    };
    const groups = {};
    (streams || []).forEach((stream, index) => {
      const type = stream.codec_type || 'data';
      if (!groups[type]) groups[type] = [];
      groups[type].push({ stream, index });
    });
    return order
      .filter((type) => groups[type]?.length)
      .map((type) => ({
        type,
        label: labels[type] || type,
        items: groups[type],
      }));
  }

  function row(label, value) {
    if (value === undefined || value === null || value === '' || Number.isNaN(value)) return '';
    return `
      <div class="info-item">
        <span class="label">${escapeHtml(label)}</span>
        <span class="value" title="${escapeHtml(value)}">${escapeHtml(value)}</span>
      </div>
    `;
  }

  function renderFormatProperties() {
    const format = jsonData.format || {};
    const shortName = filename.length > 28 ? `${filename.slice(0, 26)}…` : filename;
    mediaInfo.innerHTML = `
      <div class="info-section">
        <h3>Properties</h3>
        <div class="info-subtitle">Container</div>
        ${row('File', shortName)}
        ${row('Path', format.source_path)}
        ${row('Format', format.format_long_name || format.format_name)}
        ${row('Size', format.file_size ? `${(format.file_size / (1024 * 1024)).toFixed(2)} MB` : null)}
        ${row('Duration', formatDuration(format.duration))}
        ${row('Bit rate', formatBitrate(format.bit_rate))}
        ${row('Streams', String((jsonData.streams || []).length))}
        ${row('Probe score', format.probe_score)}
      </div>
    `;
  }

  function renderStreamProperties(stream, listIndex) {
    const type = stream.codec_type || 'stream';
    const gopSize = type === 'video' ? detectGOP(jsonData.frames) : null;
    const level = stream.level != null && stream.level !== -99
      ? (Number(stream.level) >= 10 ? (Number(stream.level) / 10).toFixed(1) : stream.level)
      : null;

    let typeRows = '';
    if (type === 'video') {
      typeRows = [
        row('Resolution', stream.width && stream.height ? `${stream.width}×${stream.height}` : null),
        row('Aspect ratio', formatAspectRatio(stream)),
        row('Frame rate', formatFps(stream.r_frame_rate || stream.avg_frame_rate)),
        row('Avg frame rate', formatFps(stream.avg_frame_rate)),
        row('Bits per pixel', formatBitsPerPixel(stream)),
        row('Pixel format', stream.pix_fmt),
        row('Color space', stream.color_space),
        row('Color range', stream.color_range),
        row('Color primaries', stream.color_primaries),
        row('Color transfer', stream.color_transfer),
        row('Bits per raw sample', stream.bits_per_raw_sample),
        row('Field order', stream.field_order || 'progressive'),
        row('GOP size', gopSize != null ? `${gopSize} frames` : null),
        row('Has B-frames', stream.has_b_frames),
        row('Refs', stream.refs),
      ].join('');
    } else if (type === 'audio') {
      typeRows = [
        row('Sample rate', stream.sample_rate ? `${stream.sample_rate} Hz` : null),
        row('Channels', stream.channels),
        row('Channel layout', stream.channel_layout),
        row('Sample format', stream.sample_fmt),
        row('Bits per sample', stream.bits_per_sample || stream.bits_per_raw_sample),
      ].join('');
    } else if (type === 'subtitle') {
      typeRows = [
        row('Width', stream.width),
        row('Height', stream.height),
      ].join('');
    }

    const tagRows = Object.entries(stream.tags || {})
      .map(([key, value]) => row(key, value))
      .join('');

    const dispositionOn = Object.entries(stream.disposition || {})
      .filter(([, value]) => Number(value) === 1)
      .map(([key]) => key)
      .join(', ');

    mediaInfo.innerHTML = `
      <div class="info-section">
        <h3>Properties</h3>
        <div class="info-subtitle">${escapeHtml(type)} · #${stream.index ?? listIndex}</div>
        ${row('Codec', stream.codec_long_name || stream.codec_name)}
        ${row('Codec name', stream.codec_name)}
        ${row('Profile', stream.profile)}
        ${row('Level', level)}
        ${row('Bit rate', formatBitrate(stream.bit_rate))}
        ${row('Duration', formatDuration(stream.duration || stream.tags?.DURATION))}
        ${row('Time base', stream.time_base)}
        ${row('Start', formatDuration(stream.start_time))}
        ${row('Frames', stream.nb_frames)}
        ${typeRows}
        ${row('Disposition', dispositionOn || null)}
        ${tagRows ? `<div class="info-subtitle">Tags</div>${tagRows}` : ''}
      </div>
    `;
  }

  function selectNode(kind, streamIndex) {
    streamTree.querySelectorAll('.tree-node, .tree-leaf').forEach((el) => {
      el.classList.remove('is-selected');
    });

    if (kind === 'format') {
      const node = streamTree.querySelector('[data-kind="format"]');
      if (node) node.classList.add('is-selected');
      renderFormatProperties();
      return;
    }

    const leaf = streamTree.querySelector(`[data-kind="stream"][data-index="${streamIndex}"]`);
    if (leaf) leaf.classList.add('is-selected');
    const stream = jsonData.streams?.[streamIndex];
    if (stream) renderStreamProperties(stream, streamIndex);
  }

  function renderTree() {
    const groups = groupStreams(jsonData.streams);
    const shortName = filename.length > 34 ? `${filename.slice(0, 32)}…` : filename;

    const groupHtml = groups.map((group) => {
      const leaves = group.items.map(({ stream, index }, typeIndex) => `
        <button type="button" class="tree-leaf" data-kind="stream" data-index="${index}">
          <span class="tree-leaf-label">${escapeHtml(streamLabel(stream, typeIndex))}</span>
        </button>
      `).join('');
      return `
        <div class="tree-group">
          <div class="tree-group-label">${escapeHtml(group.label)}</div>
          <div class="tree-group-children">${leaves}</div>
        </div>
      `;
    }).join('');

    streamTree.innerHTML = `
      <div class="tree-header">Tracks</div>
      <button type="button" class="tree-node" data-kind="format">
        <span class="tree-node-title">${escapeHtml(shortName)}</span>
        <span class="tree-node-meta">Container</span>
      </button>
      ${groupHtml || '<div class="tree-empty">No streams found</div>'}
    `;

    streamTree.querySelector('[data-kind="format"]')?.addEventListener('click', () => {
      selectNode('format');
    });

    streamTree.querySelectorAll('[data-kind="stream"]').forEach((leaf) => {
      leaf.addEventListener('click', () => {
        selectNode('stream', Number(leaf.dataset.index));
      });
    });
  }

  renderTree();

  // Default selection: first video stream, else container
  const firstVideo = (jsonData.streams || []).findIndex((s) => s.codec_type === 'video');
  if (firstVideo >= 0) {
    selectNode('stream', firstVideo);
  } else {
    selectNode('format');
  }

  mediaInfo.classList.remove('hide');
}
