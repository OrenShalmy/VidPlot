function updatemediaInfo(jsonData, opts) {
  const mediaInfo = document.getElementById('mediaInfo');
  const streamTree = document.getElementById('streamTree');
  if (!mediaInfo || !streamTree) return;

  // Keep scroll anchored when swapping compare A/B so rows stay under the cursor.
  const savedScroll = mediaInfo.scrollTop;

  window.vidplotJsonData = jsonData;
  if (opts?.slot && window.vidplotCompare?.enabled) {
    window.vidplotCompare.activeSlot = opts.slot;
  }

  const filename = window.vidplotCurrentFilename
    || jsonData?.format?.filename
    || 'Unknown File';
  const displayPath = jsonData?.format?.source_path || filename;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatBitrate(bps) {
    const n = parseInt(bps, 10);
    if (!n) return null;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} Mb/s`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)} kb/s`;
    return `${n} b/s`;
  }

  function formatDuration(seconds) {
    const n = parseFloat(seconds);
    if (!isFinite(n)) return null;
    return `${n.toFixed(3)} s`;
  }

  function formatFileSize(bytes) {
    const n = parseInt(bytes, 10);
    if (!n) return null;
    if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(3)} GiB`;
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
    return `${n} B`;
  }

  function formatFps(rate) {
    if (!rate || rate === '0/0') return null;
    if (String(rate).includes('/')) {
      const [a, b] = String(rate).split('/').map(Number);
      if (!b) return String(rate);
      const n = a / b;
      return isFinite(n) ? `${n.toFixed(3)} FPS` : String(rate);
    }
    const n = parseFloat(rate);
    return isFinite(n) ? `${n.toFixed(3)} FPS` : String(rate);
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

  function inferBitsFromPixFmt(pixFmt) {
    if (!pixFmt) return null;
    const text = String(pixFmt).toLowerCase();
    for (const bits of [16, 14, 12, 10, 9]) {
      if (text.includes(`p${bits}`)) return `${bits} bits`;
    }
    return '8 bits';
  }

  function chromaFromPixFmt(pixFmt) {
    const t = String(pixFmt || '').toLowerCase();
    if (!t) return null;
    if (t.includes('440')) return '4:4:0';
    if (t.includes('444')) return '4:4:4';
    if (t.includes('422')) return '4:2:2';
    if (t.includes('420')) return '4:2:0';
    if (t.includes('411')) return '4:1:1';
    if (t.includes('410')) return '4:1:0';
    return null;
  }

  function colorSpaceFamily(pixFmt) {
    const t = String(pixFmt || '').toLowerCase();
    if (!t) return null;
    if (t.startsWith('yuv') || t.startsWith('nv') || t.includes('yuva')) return 'YUV';
    if (t.startsWith('rgb') || t.startsWith('bgr') || t.startsWith('gbr')) return 'RGB';
    if (t.includes('gray') || t.includes('mono')) return 'Y';
    return null;
  }

  function formatColorRange(value) {
    if (!value) return null;
    const t = String(value).toLowerCase();
    if (t === 'tv' || t === 'mpeg' || t === 'limited') return 'Limited';
    if (t === 'pc' || t === 'jpeg' || t === 'full') return 'Full';
    return String(value);
  }

  function formatScanType(fieldOrder) {
    if (!fieldOrder || fieldOrder === 'progressive' || fieldOrder === 'unknown') return 'Progressive';
    if (String(fieldOrder).includes('tt') || String(fieldOrder).includes('bb')
      || String(fieldOrder).includes('tb') || String(fieldOrder).includes('bt')
      || String(fieldOrder).includes('inter')) {
      return 'Interlaced';
    }
    return String(fieldOrder);
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
    const width = parseInt(stream?.width, 10);
    const height = parseInt(stream?.height, 10);
    let ratio = parseRatio(stream?.display_aspect_ratio);

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
    if (!label) label = `${ratio.toFixed(3)}:1`;
    return `${label} (${ratio.toFixed(3)})`;
  }

  function formatBitsPerPixel(stream) {
    if (!stream) return null;
    const width = parseInt(stream.width, 10);
    const height = parseInt(stream.height, 10);
    const bitrate = parseInt(stream.bit_rate, 10)
      || parseInt(jsonData.format?.bit_rate, 10);
    const fps = fpsNumber(stream.avg_frame_rate) || fpsNumber(stream.r_frame_rate);
    if (!width || !height || !bitrate || !fps) return null;
    const bpp = bitrate / (width * height * fps);
    if (!isFinite(bpp) || bpp <= 0) return null;
    return bpp.toFixed(3);
  }

  function formatCodecLevel(stream) {
    if (!stream || stream.level == null || stream.level === -99) return null;
    const raw = Number(stream.level);
    if (!Number.isFinite(raw)) return String(stream.level);
    if (raw < 10) return String(raw);
    const codec = String(stream.codec_name || '').toLowerCase();
    const divisor = (codec === 'hevc' || codec === 'h265') ? 30 : 10;
    return (raw / divisor).toFixed(1);
  }

  function detectGOP(frames) {
    const iFrameIndices = (frames || [])
      .map((frame, index) => (frame.pict_type === 'I' ? index : -1))
      .filter((index) => index !== -1);
    if (iFrameIndices.length < 2) return null;
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
    return consistency > 0.5 ? String(mostCommonGOP) : 'Variable';
  }

  function formatFrameTypeCounts(frames) {
    if (!Array.isArray(frames) || !frames.length) return null;
    const counts = { I: 0, P: 0, B: 0, other: 0 };
    frames.forEach((frame) => {
      const t = (frame?.pict_type || '').toUpperCase();
      if (t === 'I' || t === 'P' || t === 'B') counts[t] += 1;
      else counts.other += 1;
    });
    const parts = [`I ${counts.I}`, `P ${counts.P}`, `B ${counts.B}`];
    if (counts.other) parts.push(`other ${counts.other}`);
    return parts.join(' · ');
  }

  function frameRateMode(stream) {
    if (!stream) return null;
    const a = fpsNumber(stream.avg_frame_rate);
    const r = fpsNumber(stream.r_frame_rate);
    if (a && r && Math.abs(a - r) / r > 0.01) return 'Variable';
    if (a || r) return 'Constant';
    return null;
  }

  function tagValue(tags, ...keys) {
    if (!tags) return null;
    for (const key of keys) {
      if (tags[key] != null && tags[key] !== '') return String(tags[key]);
      const lower = key.toLowerCase();
      const upper = key.toUpperCase();
      if (tags[lower] != null && tags[lower] !== '') return String(tags[lower]);
      if (tags[upper] != null && tags[upper] !== '') return String(tags[upper]);
    }
    return null;
  }

  function compareSlotData(slot) {
    try {
      return window.vidplotGetCompareSlot?.(slot)?.jsonData || null;
    } catch (_) {
      return null;
    }
  }

  function streamsOfType(type) {
    return (jsonData.streams || [])
      .map((stream, index) => ({ stream, index }))
      .filter(({ stream }) => (stream.codec_type || '') === type);
  }

  /** Max stream counts across compare slots so A/B panels keep the same section layout. */
  function stableStreamCounts() {
    const countType = (data, type) => (
      (data?.streams || []).filter((s) => s.codec_type === type).length
    );
    const local = {
      video: countType(jsonData, 'video'),
      audio: countType(jsonData, 'audio'),
      text: countType(jsonData, 'subtitle'),
      data: countType(jsonData, 'data'),
      attachment: countType(jsonData, 'attachment'),
    };
    if (!(window.vidplotCompare && window.vidplotCompare.enabled)) {
      return local;
    }
    const a = compareSlotData('A');
    const b = compareSlotData('B');
    return {
      video: Math.max(local.video, countType(a, 'video'), countType(b, 'video')),
      audio: Math.max(local.audio, countType(a, 'audio'), countType(b, 'audio')),
      text: Math.max(local.text, countType(a, 'subtitle'), countType(b, 'subtitle')),
      data: Math.max(local.data, countType(a, 'data'), countType(b, 'data')),
      attachment: Math.max(
        local.attachment,
        countType(a, 'attachment'),
        countType(b, 'attachment'),
      ),
    };
  }

  function miRow(label, value) {
    const missing = value === undefined || value === null || value === '' || Number.isNaN(value);
    const display = missing ? '—' : value;
    return `
      <tr class="mi-row${missing ? ' is-missing' : ''}">
        <th scope="row">${escapeHtml(label)}</th>
        <td title="${escapeHtml(display)}">${escapeHtml(display)}</td>
      </tr>
    `;
  }

  function miSection(title, anchor, rowsHtml) {
    return `
      <section class="mi-section" id="${escapeHtml(anchor)}">
        <h2 class="mi-section-title">${escapeHtml(title)}</h2>
        <table class="mi-table">
          <tbody>${rowsHtml}</tbody>
        </table>
      </section>
    `;
  }

  function generalRows() {
    const format = jsonData.format || {};
    const videos = streamsOfType('video');
    const primary = videos[0]?.stream;
    const videoCount = (jsonData.streams || []).filter((s) => s.codec_type === 'video').length;
    const audioCount = (jsonData.streams || []).filter((s) => s.codec_type === 'audio').length;
    const textCount = (jsonData.streams || []).filter((s) => s.codec_type === 'subtitle').length;
    return [
      miRow('Complete name', displayPath),
      miRow('Format', format.format_name),
      miRow('Format/Info', format.format_long_name),
      miRow('File size', formatFileSize(format.file_size)),
      miRow('Duration', formatDuration(format.duration)),
      miRow('Overall bit rate', formatBitrate(format.bit_rate)),
      miRow('Frame rate', formatFps(primary?.r_frame_rate || primary?.avg_frame_rate)),
      miRow('Start', formatDuration(format.start_time)),
      miRow('Video streams', videoCount ? String(videoCount) : null),
      miRow('Audio streams', audioCount ? String(audioCount) : null),
      miRow('Text streams', textCount ? String(textCount) : null),
      miRow('Writing application', tagValue(format.tags, 'encoder', 'writing_application', 'Writing application')),
      miRow('Writing library', tagValue(format.tags, 'writing_library', 'Writing library')),
      miRow('Encoded date', tagValue(format.tags, 'creation_time', 'encoded_date', 'date')),
      miRow('Probe score', format.probe_score != null ? String(format.probe_score) : null),
    ].join('');
  }

  function videoRows(stream, typeIndex) {
    const frames = typeIndex === 0 ? (jsonData.frames || []) : [];
    const gop = typeIndex === 0 ? detectGOP(frames) : null;
    const colorSpace = stream?.color_space
      || (stream?.vidplot_color?.inferred_bt709 ? 'bt709 (inferred)' : null);
    return [
      miRow('ID', stream?.index != null ? String(stream.index) : null),
      miRow('Format', stream?.codec_name),
      miRow('Format/Info', stream?.codec_long_name),
      miRow('Format profile', stream?.profile),
      miRow('Format level', formatCodecLevel(stream)),
      miRow('Codec ID', stream?.codec_tag_string || stream?.codec_tag),
      miRow('Duration', formatDuration(stream?.duration || stream?.tags?.DURATION)),
      miRow('Bit rate', formatBitrate(stream?.bit_rate)),
      miRow('Width', stream?.width != null ? `${stream.width} pixels` : null),
      miRow('Height', stream?.height != null ? `${stream.height} pixels` : null),
      miRow('Display aspect ratio', formatAspectRatio(stream)),
      miRow('Frame rate mode', frameRateMode(stream)),
      miRow('Frame rate', formatFps(stream?.r_frame_rate || stream?.avg_frame_rate)),
      miRow('Color space', colorSpaceFamily(stream?.pix_fmt)),
      miRow('Chroma subsampling', chromaFromPixFmt(stream?.pix_fmt)),
      miRow('Bit depth', stream
        ? (stream.bits_per_raw_sample
          ? `${stream.bits_per_raw_sample} bits`
          : inferBitsFromPixFmt(stream.pix_fmt))
        : null),
      miRow('Scan type', stream ? formatScanType(stream.field_order) : null),
      miRow('Bits/(Pixel*Frame)', formatBitsPerPixel(stream)),
      miRow('Pixel format', stream?.pix_fmt),
      miRow('Color primaries', stream?.color_primaries),
      miRow('Transfer characteristics', stream?.color_transfer),
      miRow('Matrix coefficients', colorSpace),
      miRow('Color range', formatColorRange(stream?.color_range)),
      miRow('Chroma location', stream?.chroma_location),
      miRow('Time base', stream?.time_base),
      miRow('Start', formatDuration(stream?.start_time)),
      miRow('Frame count', stream?.nb_frames
        || (typeIndex === 0 && frames.length ? String(frames.length) : null)),
      miRow('GOP size', gop),
      miRow('Frame types', typeIndex === 0 ? formatFrameTypeCounts(frames) : null),
      miRow('Language', tagValue(stream?.tags, 'language', 'LANGUAGE')),
      miRow('Title', tagValue(stream?.tags, 'title', 'handler_name')),
      miRow('Writing library', tagValue(stream?.tags, 'encoder', 'writing_library')),
    ].join('');
  }

  function audioRows(stream) {
    return [
      miRow('ID', stream?.index != null ? String(stream.index) : null),
      miRow('Format', stream?.codec_name),
      miRow('Format/Info', stream?.codec_long_name),
      miRow('Format profile', stream?.profile),
      miRow('Codec ID', stream?.codec_tag_string || stream?.codec_tag),
      miRow('Duration', formatDuration(stream?.duration || stream?.tags?.DURATION)),
      miRow('Bit rate', formatBitrate(stream?.bit_rate)),
      miRow('Channel(s)', stream?.channels != null ? String(stream.channels) : null),
      miRow('Channel layout', stream?.channel_layout),
      miRow('Sampling rate', stream?.sample_rate ? `${stream.sample_rate} Hz` : null),
      miRow('Bit depth', stream?.bits_per_sample || stream?.bits_per_raw_sample
        ? `${stream.bits_per_sample || stream.bits_per_raw_sample} bits`
        : null),
      miRow('Sample format', stream?.sample_fmt),
      miRow('Time base', stream?.time_base),
      miRow('Start', formatDuration(stream?.start_time)),
      miRow('Frame count', stream?.nb_frames),
      miRow('Language', tagValue(stream?.tags, 'language', 'LANGUAGE')),
      miRow('Title', tagValue(stream?.tags, 'title', 'handler_name')),
    ].join('');
  }

  function textRows(stream) {
    return [
      miRow('ID', stream?.index != null ? String(stream.index) : null),
      miRow('Format', stream?.codec_name),
      miRow('Format/Info', stream?.codec_long_name),
      miRow('Codec ID', stream?.codec_tag_string || stream?.codec_tag),
      miRow('Duration', formatDuration(stream?.duration || stream?.tags?.DURATION)),
      miRow('Width', stream?.width != null ? `${stream.width} pixels` : null),
      miRow('Height', stream?.height != null ? `${stream.height} pixels` : null),
      miRow('Time base', stream?.time_base),
      miRow('Start', formatDuration(stream?.start_time)),
      miRow('Language', tagValue(stream?.tags, 'language', 'LANGUAGE')),
      miRow('Title', tagValue(stream?.tags, 'title', 'handler_name')),
    ].join('');
  }

  function otherRows(stream) {
    return [
      miRow('ID', stream?.index != null ? String(stream.index) : null),
      miRow('Format', stream?.codec_name),
      miRow('Format/Info', stream?.codec_long_name),
      miRow('Codec ID', stream?.codec_tag_string || stream?.codec_tag),
      miRow('Duration', formatDuration(stream?.duration)),
      miRow('Bit rate', formatBitrate(stream?.bit_rate)),
      miRow('Title', tagValue(stream?.tags, 'title', 'handler_name')),
    ].join('');
  }

  function maxChapterCount() {
    let n = (jsonData.chapters || []).length;
    if (window.vidplotCompare?.enabled) {
      n = Math.max(
        n,
        (compareSlotData('A')?.chapters || []).length,
        (compareSlotData('B')?.chapters || []).length,
      );
    }
    return n;
  }

  function metadataRows() {
    const formatTags = jsonData.format?.tags || {};
    const keys = [
      'creation_time',
      'encoder',
      'major_brand',
      'minor_version',
      'compatible_brands',
      'title',
      'artist',
      'album',
      'date',
      'comment',
      'description',
      'copyright',
    ];
    const shown = new Set(keys.map((key) => key.toLowerCase()));
    const fixed = keys.map((key) => miRow(key, tagValue(formatTags, key))).join('');

    // Union of extra tag keys across compare slots so A/B keep the same rows.
    const extraKeySet = new Set();
    const collectExtras = (tags) => {
      Object.keys(tags || {}).forEach((key) => {
        if (!shown.has(key.toLowerCase())) extraKeySet.add(key);
      });
    };
    collectExtras(formatTags);
    if (window.vidplotCompare?.enabled) {
      collectExtras(compareSlotData('A')?.format?.tags);
      collectExtras(compareSlotData('B')?.format?.tags);
    }
    const extras = [...extraKeySet]
      .sort((a, b) => a.localeCompare(b))
      .map((key) => miRow(key, tagValue(formatTags, key)))
      .join('');
    return fixed + extras;
  }

  function menuRows() {
    const chapters = jsonData.chapters || [];
    const max = maxChapterCount();
    const rows = [
      miRow('Chapters', chapters.length ? String(chapters.length) : null),
    ];
    // Fixed Chapter N labels so A/B rows stay aligned when titles differ.
    for (let i = 0; i < max; i += 1) {
      const ch = chapters[i];
      if (!ch) {
        rows.push(miRow(`Chapter ${i + 1}`, null));
        continue;
      }
      const title = tagValue(ch.tags, 'title');
      const range = `${formatDuration(ch.start_time) || '—'} → ${formatDuration(ch.end_time) || '—'}`;
      rows.push(miRow(`Chapter ${i + 1}`, title ? `${title} · ${range}` : range));
    }
    return rows.join('');
  }

  function renderReport() {
    const counts = stableStreamCounts();
    const videos = streamsOfType('video');
    const audios = streamsOfType('audio');
    const texts = streamsOfType('subtitle');
    const datas = streamsOfType('data');
    const attachments = streamsOfType('attachment');

    const parts = [];
    parts.push(miSection('General', 'mi-general', generalRows()));

    for (let i = 0; i < counts.video; i += 1) {
      const title = counts.video > 1 ? `Video #${i + 1}` : 'Video';
      parts.push(miSection(title, `mi-video-${i}`, videoRows(videos[i]?.stream || null, i)));
    }

    for (let i = 0; i < counts.audio; i += 1) {
      const title = counts.audio > 1 ? `Audio #${i + 1}` : 'Audio';
      parts.push(miSection(title, `mi-audio-${i}`, audioRows(audios[i]?.stream || null)));
    }

    for (let i = 0; i < counts.text; i += 1) {
      const title = counts.text > 1 ? `Text #${i + 1}` : 'Text';
      parts.push(miSection(title, `mi-text-${i}`, textRows(texts[i]?.stream || null)));
    }

    const chapterCount = maxChapterCount();
    if (chapterCount > 0) {
      parts.push(miSection('Menu', 'mi-menu', menuRows()));
    }

    for (let i = 0; i < counts.data; i += 1) {
      parts.push(miSection(
        counts.data > 1 ? `Other #${i + 1}` : 'Other',
        `mi-other-${i}`,
        otherRows(datas[i]?.stream || null),
      ));
    }
    for (let i = 0; i < counts.attachment; i += 1) {
      parts.push(miSection(
        counts.attachment > 1 ? `Image #${i + 1}` : 'Image',
        `mi-image-${i}`,
        otherRows(attachments[i]?.stream || null),
      ));
    }

    parts.push(miSection('Metadata', 'mi-metadata', metadataRows()));

    mediaInfo.innerHTML = `<div class="mi-report">${parts.join('')}</div>`;
  }

  function renderNav() {
    const counts = stableStreamCounts();
    const links = [
      { id: 'mi-general', label: 'General' },
    ];
    for (let i = 0; i < counts.video; i += 1) {
      links.push({ id: `mi-video-${i}`, label: counts.video > 1 ? `Video #${i + 1}` : 'Video' });
    }
    for (let i = 0; i < counts.audio; i += 1) {
      links.push({ id: `mi-audio-${i}`, label: counts.audio > 1 ? `Audio #${i + 1}` : 'Audio' });
    }
    for (let i = 0; i < counts.text; i += 1) {
      links.push({ id: `mi-text-${i}`, label: counts.text > 1 ? `Text #${i + 1}` : 'Text' });
    }
    if (maxChapterCount() > 0) {
      links.push({ id: 'mi-menu', label: 'Menu' });
    }
    for (let i = 0; i < counts.data; i += 1) {
      links.push({
        id: `mi-other-${i}`,
        label: counts.data > 1 ? `Other #${i + 1}` : 'Other',
      });
    }
    for (let i = 0; i < counts.attachment; i += 1) {
      links.push({
        id: `mi-image-${i}`,
        label: counts.attachment > 1 ? `Image #${i + 1}` : 'Image',
      });
    }
    links.push({ id: 'mi-metadata', label: 'Metadata' });

    streamTree.innerHTML = `
      <div class="tree-header">MediaInfo</div>
      <nav class="mi-nav" aria-label="Property sections">
        ${links.map((link) => `
          <button type="button" class="mi-nav-item" data-target="${escapeHtml(link.id)}">
            ${escapeHtml(link.label)}
          </button>
        `).join('')}
      </nav>
    `;

    streamTree.querySelectorAll('.mi-nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = mediaInfo.querySelector(`#${btn.dataset.target}`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          streamTree.querySelectorAll('.mi-nav-item').forEach((el) => {
            el.classList.toggle('is-selected', el === btn);
          });
        }
      });
    });
  }

  renderReport();
  renderNav();
  if (savedScroll != null) {
    mediaInfo.scrollTop = savedScroll;
  }
}
