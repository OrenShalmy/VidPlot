function formatFrameTimecode(seconds, fps) {
    const t = Math.max(0, Number(seconds) || 0);
    const rate = (Number.isFinite(fps) && fps > 0) ? fps : 25;
    const fpsRounded = Math.max(1, Math.round(rate));
    const totalFrames = Math.round(t * rate);
    const ff = ((totalFrames % fpsRounded) + fpsRounded) % fpsRounded;
    let rem = Math.floor(totalFrames / fpsRounded);
    const ss = rem % 60;
    rem = Math.floor(rem / 60);
    const mm = rem % 60;
    const hh = Math.floor(rem / 60);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hh)}:${pad(mm)}:${pad(ss)}.${pad(ff)}`;
}

function estimateJsonFps(jsonData) {
    const video = (jsonData?.streams || []).find((s) => s.codec_type === 'video') || {};
    const rate = video.avg_frame_rate || video.r_frame_rate;
    if (rate && String(rate).includes('/')) {
        const [a, b] = String(rate).split('/').map(Number);
        if (b && a) return a / b;
    }
    const n = parseFloat(rate);
    if (Number.isFinite(n) && n > 0) return n;
    const frames = jsonData?.frames || [];
    if (frames.length >= 2) {
        const t0 = parseFloat(frames[0].best_effort_timestamp_time);
        const t1 = parseFloat(frames[1].best_effort_timestamp_time);
        if (Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0) return 1 / (t1 - t0);
    }
    return 25;
}

function formatSecondsLabel(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? `${n.toFixed(4)} s` : '—';
}

function buildFrameCustomdata(frames, fps) {
    const total = (frames || []).length;
    const rate = (Number.isFinite(fps) && fps > 0) ? fps : 25;
    return (frames || []).map((f, i) => {
        const qp = f.mean_qp;
        const qpLabel = (qp === null || qp === undefined || qp === '')
            ? '—'
            : Number(qp).toFixed(2);
        // Prefer presentation time for timecode; fall back to best-effort
        const pts = parseFloat(f.pkt_pts_time);
        const tcBase = Number.isFinite(pts)
            ? pts
            : parseFloat(f.best_effort_timestamp_time);
        return [
            i,
            total,
            formatFrameTimecode(tcBase, rate),
            formatSecondsLabel(f.pkt_dts_time),
            formatSecondsLabel(f.pkt_pts_time),
            f.pict_type || '—',
            qpLabel,
        ];
    });
}

function vidplotUpdateMeanQp(meanQps) {
    const jsonData = window.vidplotJsonData;
    if (!jsonData || !Array.isArray(jsonData.frames)) return;
    const qps = Array.isArray(meanQps) ? meanQps : [];
    jsonData.frames.forEach((frame, index) => {
        frame.mean_qp = index < qps.length ? qps[index] : null;
    });
    jsonData.qp_available = qps.some((v) => v !== null && v !== undefined);
    jsonData.qp_pending = false;
    const chartDiv = document.getElementById('frameChart');
    if (!chartDiv || typeof Plotly === 'undefined' || !chartDiv.data) return;
    const fps = estimateJsonFps(jsonData);
    Plotly.restyle(chartDiv, { customdata: [buildFrameCustomdata(jsonData.frames, fps)] }, [0]);
}

/** Singleton transport so chart re-inits never stack listeners or leave a stale reverse RAF. */
function getVidplotTransport() {
    if (window._vidplotTransport) return window._vidplotTransport;
    const t = {
        video: null,
        api: null,
        reverseRafId: null,
        shuttleRate: 0,
        suppressPauseSideEffects: false,
        mediaNeedsWake: false,
        onPlay: null,
        onPause: null,
        onKeyDown: null,
        stopReverse() {
            if (t.reverseRafId !== null) {
                cancelAnimationFrame(t.reverseRafId);
                t.reverseRafId = null;
            }
        },
        teardown() {
            t.stopReverse();
            t.shuttleRate = 0;
            if (t.onKeyDown) {
                document.removeEventListener('keydown', t.onKeyDown, true);
                t.onKeyDown = null;
            }
            if (t.video) {
                if (t.onPlay) t.video.removeEventListener('play', t.onPlay);
                if (t.onPause) t.video.removeEventListener('pause', t.onPause);
            }
            t.onPlay = null;
            t.onPause = null;
            t.api = null;
            t.video = null;
            t.suppressPauseSideEffects = false;
        },
    };
    window._vidplotTransport = t;
    ensureVidplotFocusGuards(t);
    return t;
}

function isVidplotTypingTarget(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.closest) {
        if (el.closest('#sideMenu.collapsed')) return false;
        const hiddenHost = el.closest('[hidden], [aria-hidden="true"]');
        if (hiddenHost) return false;
    }
    try {
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
    } catch (_) {
        /* ignore */
    }
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
        const type = (el.type || '').toLowerCase();
        return type === 'text' || type === 'search' || type === 'email'
            || type === 'password' || type === 'number' || type === 'url'
            || type === '' || type === 'tel';
    }
    return !!el.isContentEditable;
}

function releaseVidplotShortcutFocus() {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return;
    // Range / Plotly / config fields steal arrow and frame-step keys after OS focus returns
    if (
        isVidplotTypingTarget(el)
        || el.id === 'seekBar'
        || (el.closest && (el.closest('#frameChart') || el.closest('.js-plotly-plot')))
    ) {
        el.blur();
    }
}

function ensureVidplotFocusGuards(transport) {
    if (window._vidplotFocusGuardsBound) return;
    window._vidplotFocusGuardsBound = true;
    const markMediaWake = () => {
        transport.mediaNeedsWake = true;
    };
    const onAppActive = () => {
        transport.mediaNeedsWake = true;
        releaseVidplotShortcutFocus();
    };
    window.addEventListener('blur', markMediaWake);
    window.addEventListener('focus', onAppActive);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') markMediaWake();
        else onAppActive();
    });
}

function setupPlotlyChart(jsonData) {
    window.vidplotJsonData = jsonData;
    if (!jsonData?.frames?.length) {
        const chart = document.getElementById('frameChart');
        if (chart) {
            chart.innerHTML = '<div class="chart-placeholder">No frame data</div>';
        }
        return;
    }

    // --- Helper Functions ---
    function bytesToMbps(bytes, duration) {
        return (bytes * 8) / (1024 * 1024 * duration);
    }
    function findClosestFrame(time, frames) {
        let closestFrame = null;
        let minDiff = Infinity;
        frames.forEach(frame => {
            const timestamp = parseFloat(frame.best_effort_timestamp_time);
            const diff = Math.abs(time - timestamp);
            if (diff < minDiff) {
                minDiff = diff;
                closestFrame = frame;
            }
        });
        return closestFrame;
    }
    function findFrameIndexByTime(time, frames) {
        let closestIdx = 0;
        let minDiff = Infinity;
        frames.forEach((frame, idx) => {
            const timestamp = parseFloat(frame.best_effort_timestamp_time);
            const diff = Math.abs(time - timestamp);
            if (diff < minDiff) {
                minDiff = diff;
                closestIdx = idx;
            }
        });
        return closestIdx;
    }
    function buildPlayheadShapes(snappedTime) {
        const updateShapes = layout.shapes.filter(s => s.name !== currentFrameShapeId);
        updateShapes.push({
            type: 'line',
            xref: 'x',
            x0: snappedTime,
            x1: snappedTime,
            yref: 'paper',
            y0: 0,
            y1: 1,
            line: {
                color: '#ff0000',
                width: 2,
                dash: 'solid'
            },
            name: currentFrameShapeId
        });
        return updateShapes;
    }

    function syncPlayheadView(currentTime, force) {
        if (!layout) return;
        const closestFrame = findClosestFrame(currentTime, jsonData.frames);
        const snappedTime = closestFrame
            ? parseFloat(closestFrame.best_effort_timestamp_time)
            : currentTime;
        const updateShapes = buildPlayheadShapes(snappedTime);
        layout.shapes = updateShapes;

        const range = layout.xaxis.range || [0, duration];
        const visible = Math.max(range[1] - range[0], frameDuration);
        const followPayload = { shapes: updateShapes };

        // When zoomed in, keep the playhead centered so the graph slides with playback
        if (visible < duration - 1e-6) {
            const newRange = clampZoomRange(snappedTime, visible);
            layout.xaxis.range = newRange;
            layout.xaxis.autorange = false;
            followPayload['xaxis.range'] = newRange;
            followPayload['xaxis.autorange'] = false;
        }

        const now = performance.now();
        if (!force && now - lastFollowRelayout < 40) {
            pendingFollowTime = currentTime;
            if (followRafId === null) {
                followRafId = requestAnimationFrame(() => {
                    followRafId = null;
                    if (pendingFollowTime !== null) {
                        const t = pendingFollowTime;
                        pendingFollowTime = null;
                        syncPlayheadView(t, true);
                    }
                });
            }
            return;
        }
        lastFollowRelayout = now;
        pendingFollowTime = null;
        syncingZoomSlider = true;
        Plotly.relayout('frameChart', followPayload).then(() => {
            syncingZoomSlider = false;
        }).catch(() => {
            syncingZoomSlider = false;
        });
    }

    function updateCurrentFrameMarker(currentTime) {
        syncPlayheadView(currentTime, false);
    }
    let seekGeneration = 0;

    function wakeMediaForSeek() {
        if (!transport.mediaNeedsWake || !videoPlayer.paused) {
            transport.mediaNeedsWake = false;
            return Promise.resolve();
        }
        transport.mediaNeedsWake = false;
        // WKWebView often ignores currentTime after app background until play() runs
        transport.suppressPauseSideEffects = true;
        const playAttempt = videoPlayer.play();
        const settle = () => {
            videoPlayer.pause();
            transport.suppressPauseSideEffects = false;
        };
        if (playAttempt && typeof playAttempt.then === 'function') {
            return playAttempt.then(settle).catch(settle);
        }
        settle();
        return Promise.resolve();
    }

    function seekToTime(time, pauseAfter) {
        const clamped = Math.max(0, Math.min(duration, time));
        const token = ++seekGeneration;
        const applySeek = () => {
            if (token !== seekGeneration) return;
            if (pauseAfter) {
                transport.suppressPauseSideEffects = true;
                videoPlayer.pause();
                transport.suppressPauseSideEffects = false;
            }
            const onSeeked = function() {
                videoPlayer.removeEventListener('seeked', onSeeked);
                if (token !== seekGeneration) return;
                updateCurrentFrameMarker(clamped);
            };
            videoPlayer.addEventListener('seeked', onSeeked);
            videoPlayer.currentTime = clamped;
            // Some engines skip 'seeked' for tiny moves — keep marker honest
            updateCurrentFrameMarker(clamped);
            // If the seek was ignored (common after OS focus return), nudge once more
            requestAnimationFrame(() => {
                if (token !== seekGeneration) return;
                if (Math.abs((videoPlayer.currentTime || 0) - clamped) <= 0.08) return;
                transport.mediaNeedsWake = true;
                wakeMediaForSeek().then(() => {
                    if (token !== seekGeneration) return;
                    videoPlayer.currentTime = clamped;
                    updateCurrentFrameMarker(clamped);
                });
            });
        };
        wakeMediaForSeek().then(applySeek);
    }
    function stepFrame(delta) {
        if (!jsonData.frames || jsonData.frames.length === 0) return;
        pausePlayback();
        const t = Number(videoPlayer.currentTime);
        if (!Number.isFinite(t)) return;
        const currentIdx = findFrameIndexByTime(t, jsonData.frames);
        const closestTime = parseFloat(jsonData.frames[currentIdx].best_effort_timestamp_time);
        let targetIdx = currentIdx;
        // If playhead is past the closest frame, forward should advance; if before, backward should retreat
        if (delta > 0 && t > closestTime + frameDuration * 0.05) {
            targetIdx = currentIdx + 1;
        } else if (delta < 0 && t < closestTime - frameDuration * 0.05) {
            targetIdx = currentIdx - 1;
        } else {
            targetIdx = currentIdx + delta;
        }
        targetIdx = Math.max(0, Math.min(jsonData.frames.length - 1, targetIdx));
        const targetTime = parseFloat(jsonData.frames[targetIdx].best_effort_timestamp_time);
        if (!Number.isFinite(targetTime)) return;
        seekToTime(targetTime, true);
    }

    // --- Variable Setup ---
    let syncingZoomSlider = false;
    let followRafId = null;
    let pendingFollowTime = null;
    let lastFollowRelayout = 0;
    let currentZoomLevel = 1;
    let layout = null;
    const currentFrameShapeId = 'current-frame-marker';
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer) {
        console.error('Required DOM elements not found.');
        return;
    }
    const transport = getVidplotTransport();
    // Tear down prior chart session (listeners + reverse RAF) before rebinding
    transport.teardown();
    transport.video = videoPlayer;
    const duration = parseFloat(jsonData.format.duration);
    const allFrames = jsonData.frames.map(f => ({
        ...f,
        timestamp: parseFloat(f.best_effort_timestamp_time),
        pktSize: parseInt(f.pkt_size)
    }));
    const frameTimestamps = allFrames.map(f => f.timestamp);
    const frameDuration = allFrames.length > 1 ? (frameTimestamps[1] - frameTimestamps[0]) : 1 / 30;
    const primaryVideo = (jsonData.streams || []).find((s) => s.codec_type === 'video')
        || jsonData.streams?.[0]
        || {};
    const bitRate = primaryVideo.bit_rate;
    const mbps = bitRate ? bitRate / (1024 * 1000) : 0;
    const maxZoom = Math.max(2, Math.min(200, Math.ceil(duration / Math.max(frameDuration * 4, 0.05))));

    // --- Playback Helpers (state on transport singleton) ---
    function stopReversePlayback() {
        transport.stopReverse();
    }

    function playBackwardAt(speed) {
        const rate = Math.max(1, Math.min(4, speed));
        stopReversePlayback();
        // pause() fires a 'pause' listener that would clear shuttleRate before reverse starts
        transport.suppressPauseSideEffects = true;
        videoPlayer.pause();
        transport.suppressPauseSideEffects = false;
        let lastTs = performance.now();
        function tick(now) {
            // Ignore stale RAF from a previous chart/video session
            if (transport.video !== videoPlayer || transport.shuttleRate >= 0) {
                transport.reverseRafId = null;
                return;
            }
            const dt = ((now - lastTs) / 1000) * rate;
            lastTs = now;
            const nextTime = videoPlayer.currentTime - dt;
            if (nextTime <= 0) {
                videoPlayer.currentTime = 0;
                transport.shuttleRate = 0;
                syncPlayheadView(0, true);
                stopReversePlayback();
                return;
            }
            videoPlayer.currentTime = nextTime;
            syncPlayheadView(nextTime, false);
            transport.reverseRafId = requestAnimationFrame(tick);
        }
        transport.reverseRafId = requestAnimationFrame(tick);
    }

    function applyShuttle(rate) {
        const next = Math.max(-4, Math.min(4, rate | 0));
        transport.shuttleRate = next;
        if (next === 0) {
            stopReversePlayback();
            videoPlayer.pause();
            videoPlayer.playbackRate = 1;
            return;
        }
        if (next > 0) {
            stopReversePlayback();
            videoPlayer.playbackRate = next;
            videoPlayer.play().catch(() => {});
            return;
        }
        playBackwardAt(-next);
    }

    function bumpShuttleForward() {
        if (transport.shuttleRate <= 0) applyShuttle(1);
        else applyShuttle(Math.min(4, transport.shuttleRate + 1));
    }

    function bumpShuttleBackward() {
        if (transport.shuttleRate >= 0) applyShuttle(-1);
        else applyShuttle(Math.max(-4, transport.shuttleRate - 1));
    }

    function pausePlayback() {
        applyShuttle(0);
    }

    function togglePlayback() {
        if (transport.shuttleRate !== 0 || transport.reverseRafId !== null || !videoPlayer.paused) {
            pausePlayback();
        } else {
            applyShuttle(1);
        }
    }

    // --- Zoom Helpers ---
    function getZoomCenter() {
        if (layout.xaxis.range) {
            return (layout.xaxis.range[0] + layout.xaxis.range[1]) / 2;
        }
        return videoPlayer.currentTime || duration / 2;
    }
    function clampZoomRange(center, visibleDuration) {
        const half = visibleDuration / 2;
        let min = center - half;
        let max = center + half;
        if (min < 0) {
            min = 0;
            max = Math.min(duration, visibleDuration);
        }
        if (max > duration) {
            max = duration;
            min = Math.max(0, duration - visibleDuration);
        }
        return [min, max];
    }
    function applyZoomLevel(zoomLevel, centerTime) {
        const level = Math.max(1, Math.min(maxZoom, zoomLevel));
        let range;
        if (level <= 1) {
            range = [0, duration];
        } else {
            const visibleDuration = duration / level;
            range = clampZoomRange(centerTime ?? getZoomCenter(), visibleDuration);
        }
        layout.xaxis.range = range;
        layout.xaxis.autorange = false;
        currentZoomLevel = level;
        syncingZoomSlider = true;
        Plotly.relayout('frameChart', {
            'xaxis.autorange': false,
            'xaxis.range': range
        }).then(() => {
            syncingZoomSlider = false;
        });
    }
    function zoomLevelFromRange(range) {
        if (!range || range.length < 2) return 1;
        const visible = Math.max(range[1] - range[0], frameDuration);
        return Math.max(1, Math.min(maxZoom, duration / visible));
    }

    // --- Plotly Traces and Layout ---
    function createTraces() {
        const colors = jsonData.frames.map(f => {
            if (f.pict_type === 'I') return '#0161ff';
            if (f.pict_type === 'P') return '#70a6ff';
            if (f.pict_type === 'B') return 'rgba(224, 224, 224, 0.85)';
            return '#888888';
        });
        const fps = estimateJsonFps(jsonData);
        return [
            {
                x: jsonData.frames.map(f => parseFloat(f.best_effort_timestamp_time)),
                y: jsonData.frames.map(f => bytesToMbps(parseInt(f.pkt_size), frameDuration)),
                type: 'bar',
                name: 'Frames',
                marker: { color: colors },
                hovertemplate:
                    "Frame #: %{customdata[0]} / %{customdata[1]}<br>" +
                    "Timecode: %{customdata[2]}<br>" +
                    "DTS: %{customdata[3]}<br>" +
                    "PTS: %{customdata[4]}<br>" +
                    "Size: %{y:.2f} Mb<br>" +
                    "Type: %{customdata[5]}<br>" +
                    "Avg QP: %{customdata[6]}" +
                    "<extra></extra>",
                customdata: buildFrameCustomdata(jsonData.frames, fps)
            }
        ];
    }
    function getChartHeight() {
        if (typeof window.vidplotIsGraphCollapsed === "function" && window.vidplotIsGraphCollapsed()) {
            const peek = typeof window.vidplotGetPeekChartHeight === "function"
                ? window.vidplotGetPeekChartHeight()
                : 72;
            return peek;
        }
        // Prefer the wrap box — it is flex-sized by the parent and settles after fold/expand.
        const wrap = document.getElementById('frameChartWrap');
        if (wrap && wrap.clientHeight > 0) {
            return Math.max(80, wrap.clientHeight);
        }
        const section = document.getElementById('frameGraphSection');
        const graphBar = document.querySelector('.panel-graph-bar');
        if (!section) return 220;
        const barHeight = graphBar ? graphBar.offsetHeight : 0;
        const available = section.clientHeight - barHeight - 4;
        return Math.max(80, available);
    }

    let resizeFrameChartTimer = null;
    function resizeFrameChart() {
        const chartDiv = document.getElementById('frameChart');
        if (!chartDiv || typeof Plotly === 'undefined' || !chartDiv.data) return;
        if (!layout) return;
        const collapsed = typeof window.vidplotIsGraphCollapsed === "function"
            && window.vidplotIsGraphCollapsed();
        const nextHeight = getChartHeight();
        // Skip no-op relayouts from ResizeObserver feedback
        if (
            Math.abs((layout.height || 0) - nextHeight) < 1
            && !!layout._vidplotCollapsed === collapsed
        ) {
            return;
        }
        layout.height = nextHeight;
        layout._vidplotCollapsed = collapsed;
        // Peek mode: tiny plot + zoom dragmode eats clicks; disable drag and shrink chrome.
        const margin = collapsed
            ? { l: 8, r: 8, t: 2, b: 2 }
            : { l: 56, r: 24, t: 16, b: 40 };
        layout.margin = margin;
        layout.dragmode = collapsed ? false : 'zoom';
        layout.hovermode = collapsed ? 'x' : 'closest';
        const payload = {
            height: layout.height,
            autosize: true,
            margin,
            dragmode: layout.dragmode,
            hovermode: layout.hovermode,
            'xaxis.title.text': collapsed ? '' : 'Timestamp (s)',
            'yaxis.title.text': collapsed ? '' : 'Frame size (Mb)',
            'xaxis.showticklabels': !collapsed,
            'yaxis.showticklabels': !collapsed,
            'xaxis.ticks': collapsed ? '' : 'outside',
            'yaxis.ticks': collapsed ? '' : 'outside',
        };
        Plotly.relayout('frameChart', payload).then(() => {
            Plotly.Plots.resize(chartDiv);
        }).catch(() => {
            Plotly.Plots.resize(chartDiv);
        });
    }

    function scheduleResizeFrameChart() {
        if (resizeFrameChartTimer !== null) {
            clearTimeout(resizeFrameChartTimer);
        }
        resizeFrameChartTimer = setTimeout(() => {
            resizeFrameChartTimer = null;
            resizeFrameChart();
        }, 16);
    }

    window.vidplotResizeFrameChart = resizeFrameChart;

    let traces = createTraces();
    layout = {
        title: '',
        xaxis: {
            title: { text: 'Timestamp (s)', font: { size: 11, color: '#8b93a7' } },
            color: '#8b93a7',
            gridcolor: 'rgba(255,255,255,0.04)',
            zeroline: false,
            fixedrange: false,
            range: [0, duration],
            autorange: false
        },
        yaxis: {
            title: { text: 'Frame size (Mb)', font: { size: 11, color: '#8b93a7' } },
            color: '#8b93a7',
            gridcolor: 'rgba(255,255,255,0.06)',
            zeroline: false,
            fixedrange: true
        },
        plot_bgcolor: '#181c24',
        paper_bgcolor: '#181c24',
        font: { color: '#e0e0e0', family: 'DM Sans, sans-serif', size: 12 },
        zoommode: 'x',
        dragmode: 'zoom',
        showlegend: false,
        height: getChartHeight(),
        autosize: true,
        margin: { l: 56, r: 24, t: 16, b: 40 },
        shapes: [
            {
                type: 'line',
                xref: 'paper',
                x0: 0,
                x1: 1,
                yref: 'y',
                y0: mbps,
                y1: mbps,
                line: { color: '#f200ff', width: 1.5, dash: 'dot' },
            }
        ],
        annotations: [
            {
                xref: 'paper',
                yref: 'y',
                x: 0.01,
                y: mbps,
                text: `Avg ${mbps.toFixed(2)} Mb/s`,
                showarrow: false,
                xanchor: 'left',
                yanchor: 'bottom',
                font: { size: 11, color: '#f200ff', family: 'IBM Plex Mono, monospace' },
                bgcolor: 'rgba(24, 28, 36, 0.75)',
                borderpad: 3,
                opacity: 0.95,
            }
        ]
    };

    let lastChartSeekMs = 0;
    function seekChartToTime(clickedTime) {
        const now = performance.now();
        if (now - lastChartSeekMs < 40) return;
        lastChartSeekMs = now;
        const t = Math.max(0, Math.min(duration, Number(clickedTime)));
        if (!Number.isFinite(t)) return;
        if (transport.shuttleRate < 0) pausePlayback();
        videoPlayer.currentTime = t;
        syncPlayheadView(t, true);
    }

    // --- Plotly Chart Init ---
    Plotly.newPlot('frameChart', traces, layout, {
        displaylogo: false,
        annotations: true,
        responsive: true,
        useResizeHandler: true,
        modeBarButtonsToRemove: [
            'select2d', 'lasso2d', 'autoScale2d', 'toggleSpikelines',
            'zoom2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d', 'pan2d', 'zoomy'
        ],
        modeBarButtonsToAdd: [
            {
                name: 'Zoom X',
                icon: Plotly.Icons.zoom,
                click: function(gd) { Plotly.relayout(gd, {'dragmode': 'zoom'}); }
            }
        ]
    }).then(() => {
        const chartDiv = document.getElementById('frameChart');
        chartDiv.on('plotly_click', function(data) {
            if (data.points && data.points.length > 0) {
                const clickedTime = parseFloat(data.points[0].x);
                seekChartToTime(clickedTime);
            }
        });
        // Peek strip: map raw x-position when point picking / zoom drag would miss
        chartDiv.addEventListener('click', function(evt) {
            if (typeof window.vidplotIsGraphCollapsed !== 'function' || !window.vidplotIsGraphCollapsed()) {
                return;
            }
            if (evt.target && evt.target.closest && evt.target.closest('.modebar')) return;
            const full = chartDiv._fullLayout;
            if (!full || !full.xaxis) return;
            const xa = full.xaxis;
            const plotLeft = chartDiv.getBoundingClientRect().left + (xa._offset || full.margin.l || 0);
            const plotWidth = xa._length || 0;
            if (plotWidth <= 0) return;
            const frac = Math.max(0, Math.min(1, (evt.clientX - plotLeft) / plotWidth));
            const range = (layout.xaxis && layout.xaxis.range) || [0, duration];
            const clickedTime = range[0] + frac * (range[1] - range[0]);
            if (!Number.isFinite(clickedTime)) return;
            seekChartToTime(clickedTime);
        });
        chartDiv.on('plotly_relayout', function(eventData) {
            if (syncingZoomSlider) return;
            let range = null;
            if (eventData['xaxis.range[0]'] !== undefined && eventData['xaxis.range[1]'] !== undefined) {
                range = [eventData['xaxis.range[0]'], eventData['xaxis.range[1]']];
            } else if (Array.isArray(eventData['xaxis.range'])) {
                range = eventData['xaxis.range'];
            } else if (eventData['xaxis.autorange']) {
                range = [0, duration];
            }
            if (!range) return;
            layout.xaxis.range = range;
            currentZoomLevel = zoomLevelFromRange(range);
        });
        layout.height = getChartHeight();
        Plotly.relayout('frameChart', { height: layout.height, autosize: true });
        Plotly.Plots.resize(chartDiv);
        const wrap = document.getElementById('frameChartWrap');
        if (wrap && typeof ResizeObserver !== 'undefined' && !wrap._vidplotRo) {
            const ro = new ResizeObserver(() => scheduleResizeFrameChart());
            ro.observe(wrap);
            wrap._vidplotRo = ro;
        }
    });

    window.onresize = function() {
        scheduleResizeFrameChart();
    };

    // --- Video/Marker Sync ---
    videoPlayer.ontimeupdate = function() {
        if (transport.reverseRafId !== null) return;
        syncPlayheadView(videoPlayer.currentTime, false);
    };
    videoPlayer.onended = function() {
        transport.shuttleRate = 0;
        videoPlayer.playbackRate = 1;
    };

    transport.onPlay = () => {
        if (transport.video !== videoPlayer) return;
        if (transport.shuttleRate <= 0 && transport.reverseRafId === null) {
            const rate = Number(videoPlayer.playbackRate) || 1;
            transport.shuttleRate = Math.max(1, Math.min(4, Math.round(rate)));
        }
    };
    transport.onPause = () => {
        if (transport.video !== videoPlayer) return;
        if (transport.suppressPauseSideEffects || transport.reverseRafId !== null) return;
        transport.shuttleRate = 0;
        videoPlayer.playbackRate = 1;
    };
    videoPlayer.addEventListener('play', transport.onPlay);
    videoPlayer.addEventListener('pause', transport.onPause);

    // --- Page-wide Keyboard Shortcuts (document capture only — never also on video) ---
    function handleKeydown(e) {
        // Guard against duplicate delivery if anything else re-dispatches
        if (e._vidplotHandled || e.metaKey || e.ctrlKey || e.altKey) return;
        if (isVidplotTypingTarget(document.activeElement)) return;

        const key = e.key;
        const code = e.code || '';
        const lower = key.length === 1 ? key.toLowerCase() : key;
        const isArrowRight = key === 'ArrowRight' || code === 'ArrowRight';
        const isArrowLeft = key === 'ArrowLeft' || code === 'ArrowLeft';
        const isFrameForward = key === '>' || key === '.' || code === 'Period';
        const isFrameBack = key === '<' || key === ',' || code === 'Comma';
        const isTransport =
            isArrowRight || isArrowLeft
            || isFrameForward || isFrameBack
            || key === ' ' || key === 'Spacebar' || code === 'Space'
            || lower === 'j' || lower === 'k' || lower === 'l'
            || key === '+' || key === '=' || key === '-';
        if (!isTransport) return;
        // Space/K must not auto-repeat (would toggle/pause-spam); J/L and frame step may
        if (e.repeat && (key === ' ' || key === 'Spacebar' || code === 'Space' || lower === 'k')) return;

        e._vidplotHandled = true;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        // Seek/frame keys are often swallowed by focused range/Plotly after OS focus return
        if (isArrowRight || isArrowLeft || isFrameForward || isFrameBack) {
            releaseVidplotShortcutFocus();
        }

        try {
            if (isArrowRight) {
                if (transport.shuttleRate < 0) pausePlayback();
                seekToTime(videoPlayer.currentTime + 1, false);
            } else if (isArrowLeft) {
                if (transport.shuttleRate < 0) pausePlayback();
                seekToTime(videoPlayer.currentTime - 1, false);
            } else if (isFrameForward) {
                stepFrame(1);
            } else if (isFrameBack) {
                stepFrame(-1);
            } else if (key === ' ' || key === 'Spacebar' || code === 'Space') {
                togglePlayback();
            } else if (lower === 'j') {
                bumpShuttleBackward();
            } else if (lower === 'k') {
                pausePlayback();
            } else if (lower === 'l') {
                bumpShuttleForward();
            } else if (key === '+' || key === '=') {
                applyZoomLevel(currentZoomLevel * 2, videoPlayer.currentTime || getZoomCenter());
            } else if (key === '-') {
                applyZoomLevel(Math.max(1, Math.round(currentZoomLevel / 2)), videoPlayer.currentTime || getZoomCenter());
            }
        } catch (err) {
            console.error('transport key failed:', err);
        }
    }

    transport.onKeyDown = handleKeydown;
    document.addEventListener('keydown', handleKeydown, true);
    ensureVidplotFocusGuards(transport);
    // Drop legacy dual-binding if an older session left it around
    if (window._vidplotKeyHandler) {
        document.removeEventListener('keydown', window._vidplotKeyHandler, true);
        videoPlayer.removeEventListener('keydown', window._vidplotKeyHandler, true);
        window._vidplotKeyHandler = null;
    }
}
