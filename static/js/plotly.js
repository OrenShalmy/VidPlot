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

/** First presentation timestamp / container start — used to detect live-TS style offsets. */
function detectTimelineOrigin(jsonData) {
    const frames = jsonData?.frames || [];
    for (let i = 0; i < frames.length; i += 1) {
        const t = parseFloat(frames[i].best_effort_timestamp_time);
        if (Number.isFinite(t)) return t;
    }
    const video = (jsonData?.streams || []).find((s) => s.codec_type === 'video') || {};
    const st = parseFloat(video.start_time ?? jsonData?.format?.start_time);
    return Number.isFinite(st) ? st : 0;
}

function detectStreamStartTime(jsonData) {
    const video = (jsonData?.streams || []).find((s) => s.codec_type === 'video') || {};
    const st = parseFloat(video.start_time ?? jsonData?.format?.start_time);
    return Number.isFinite(st) ? st : 0;
}

function formatTimelineOffsetLabel(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    const sign = n < 0 ? '−' : '+';
    if (abs >= 1000) return `${sign}${abs.toFixed(2)} s`;
    if (abs >= 10) return `${sign}${abs.toFixed(3)} s`;
    return `${sign}${abs.toFixed(4)} s`;
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
            // Keep transport.api across chart re-inits (preview adapter)
            t.video = t.api || null;
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
    // Seek / Plotly / time-mode steal arrow and frame-step keys after OS focus returns.
    // Never blur text fields here — that used to steal keystrokes (e.g. "l" in pixel format).
    if (
        el.id === 'seekBar'
        || el.id === 'timeDisplayMode'
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
    const rebaseBtn = document.getElementById('timelineRebaseBtn');
    if (!jsonData?.frames?.length) {
        if (rebaseBtn) rebaseBtn.hidden = true;
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
        const ptsProbe = mediaTimeToFramePts(currentTime);
        const closestFrame = findClosestFrame(ptsProbe, jsonData.frames);
        const snappedPts = closestFrame
            ? parseFloat(closestFrame.best_effort_timestamp_time)
            : ptsProbe;
        const snappedTime = framePtsToChartX(snappedPts);
        const updateShapes = buildPlayheadShapes(snappedTime);
        layout.shapes = updateShapes;

        const range = layout.xaxis.range || [chartAxisMin(), chartAxisMax()];
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

    function effectiveDuration() {
        if (Number.isFinite(duration) && duration > 0) return duration;
        const vd = Number(videoPlayer.duration);
        if (Number.isFinite(vd) && vd > 0) return vd;
        return Infinity;
    }

    function wakeMediaForSeek() {
        videoPlayer = media();
        transport.video = videoPlayer;
        if (isFfmpegPreview() || !transport.mediaNeedsWake) {
            transport.mediaNeedsWake = false;
            return Promise.resolve();
        }
        transport.mediaNeedsWake = false;
        // Chromium / WKWebView ignore currentTime after app background until play() runs
        const wasPaused = videoPlayer.paused;
        transport.suppressPauseSideEffects = true;
        const playAttempt = videoPlayer.play();
        const settle = () => {
            if (wasPaused) videoPlayer.pause();
            transport.suppressPauseSideEffects = false;
        };
        if (playAttempt && typeof playAttempt.then === 'function') {
            return playAttempt.then(settle).catch(settle);
        }
        settle();
        return Promise.resolve();
    }

    // Compare frame lock, when both slots have a settled frame table.
    function compareFrameLock() {
        if (!window.vidplotCompare?.enabled) return null;
        if (typeof window.vidplotCompareFrameLockState !== 'function') return null;
        const st = window.vidplotCompareFrameLockState();
        return st && st.ready ? st : null;
    }

    // Local interval from a slot's own timestamps (not the CFR-only frameDuration).
    function localInterval(pts, i) {
        const here = pts[i];
        const next = i + 1 < pts.length ? pts[i + 1] : NaN;
        if (Number.isFinite(here) && Number.isFinite(next) && next > here) return next - here;
        const prev = i > 0 ? pts[i - 1] : NaN;
        if (Number.isFinite(here) && Number.isFinite(prev) && here > prev) return here - prev;
        return frameDuration || 1 / 30;
    }

    // Nearest index in a plain PTS array (the lock's tables are numbers, not
    // frame objects -- they may come from the cheap packet probe).
    function findIdxByPts(pts, time) {
        let bestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < pts.length; i += 1) {
            const d = Math.abs(time - pts[i]);
            if (d < minDiff) { minDiff = d; bestIdx = i; }
        }
        return bestIdx;
    }

    function applyDirectSeek(clamped, token, pauseAfter, refIdx) {
        if (token !== seekGeneration) return;
        videoPlayer = media();
        transport.video = videoPlayer;
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
        // Frame-exact path: hand the ref INDEX to the sync adapter so each slot
        // resolves its own time. A single shared `clamped` cannot be right for
        // both slots once they differ in start_time or preview path.
        if (typeof refIdx === 'number'
            && typeof videoPlayer.seekToFrame === 'function'
            && videoPlayer.seekToFrame(refIdx, true)) {
            updateCurrentFrameMarker(clamped);
            return;
        }
        if (typeof videoPlayer.seekTo === 'function') {
            videoPlayer.seekTo(clamped, true);
        } else if (typeof videoPlayer.fastSeek === 'function') {
            try {
                videoPlayer.fastSeek(clamped);
            } catch (_) {
                videoPlayer.currentTime = clamped;
            }
        } else {
            videoPlayer.currentTime = clamped;
        }
        updateCurrentFrameMarker(clamped);
    }

    function seekToTime(time, pauseAfter, refIdx) {
        const maxT = effectiveDuration();
        const clamped = Math.max(0, Math.min(maxT, time));
        const token = ++seekGeneration;
        const applySeek = () => {
            if (token !== seekGeneration) return;
            applyDirectSeek(clamped, token, pauseAfter, refIdx);
            if (isFfmpegPreview()) return;
            // If the seek was ignored (common after OS focus return), wake and retry
            requestAnimationFrame(() => {
                if (token !== seekGeneration) return;
                // Frame-locked seeks land half a frame off `clamped` by design,
                // so widen the "did it move" test to a frame either way.
                const tol = typeof refIdx === 'number' ? Math.max(0.08, frameDuration) : 0.08;
                if (Math.abs((videoPlayer.currentTime || 0) - clamped) <= tol) return;
                transport.mediaNeedsWake = true;
                wakeMediaForSeek().then(() => {
                    if (token !== seekGeneration) return;
                    applyDirectSeek(clamped, token, pauseAfter, refIdx);
                });
            });
        };
        releaseVidplotShortcutFocus();
        wakeMediaForSeek().then(applySeek);
    }
    function stepFrame(delta) {
        // In compare mode A is index-truth regardless of which slot is active
        // for inspection, so step against A's table -- not the active slot's.
        const lock = compareFrameLock();
        const ptsA = lock ? lock.ptsA : null;
        const frames = lock ? null : jsonData.frames;
        const count = lock ? ptsA.length : (frames ? frames.length : 0);
        if (!count) return;
        pausePlayback();

        // Prefer the ref index the sync adapter is actually locked to. Deriving
        // position from currentTime is what forces the boundary tolerance
        // below, and on the ffmpeg path (which lands half a frame BELOW the
        // PTS) it derives one frame low.
        let targetIdx = null;
        if (lock && typeof videoPlayer._vidplotRefIdx === 'number') {
            targetIdx = videoPlayer._vidplotRefIdx + delta;
        } else {
            const t = Number(videoPlayer.currentTime);
            if (!Number.isFinite(t)) return;
            const ptsNow = mediaTimeToFramePts(t);
            const currentIdx = lock
                ? findIdxByPts(ptsA, ptsNow)
                : findFrameIndexByTime(ptsNow, frames);
            const closestTime = lock
                ? ptsA[currentIdx]
                : parseFloat(frames[currentIdx].best_effort_timestamp_time);
            const iv = lock
                ? localInterval(ptsA, currentIdx)
                : localInterval(
                    frames.map((f) => parseFloat(f.best_effort_timestamp_time)),
                    currentIdx,
                );
            // If playhead is past the closest frame, forward should advance; if before, backward should retreat
            if (delta > 0 && ptsNow > closestTime + iv * 0.05) {
                targetIdx = currentIdx + 1;
            } else if (delta < 0 && ptsNow < closestTime - iv * 0.05) {
                targetIdx = currentIdx - 1;
            } else {
                targetIdx = currentIdx + delta;
            }
        }
        targetIdx = Math.max(0, Math.min(count - 1, targetIdx));
        const targetPts = lock
            ? ptsA[targetIdx]
            : parseFloat(frames[targetIdx].best_effort_timestamp_time);
        if (!Number.isFinite(targetPts)) return;
        const seekMedia = lock ? targetPts : framePtsToMediaTime(targetPts);
        seekToTime(seekMedia, true, lock ? targetIdx : undefined);
    }

    // --- Variable Setup ---
    let syncingZoomSlider = false;
    let followRafId = null;
    let pendingFollowTime = null;
    let lastFollowRelayout = 0;
    let currentZoomLevel = 1;
    let layout = null;
    const currentFrameShapeId = 'current-frame-marker';
    const videoEl = document.getElementById('videoPlayer');
    if (!videoEl) {
        console.error('Required DOM elements not found.');
        return;
    }
    const transport = getVidplotTransport();
    // Tear down prior chart session (listeners + reverse RAF) before rebinding
    transport.teardown();
    function media() {
        return (typeof window.vidplotGetMedia === 'function' && window.vidplotGetMedia())
            || transport.api
            || videoEl;
    }
    let videoPlayer = media();
    transport.video = videoPlayer;
    function isFfmpegPreview() {
        return window.vidplotPreviewMode === 'ffmpeg'
            || !!(media() && media()._vidplotMode === 'ffmpeg');
    }
    const duration = parseFloat(jsonData.format.duration);
    const timelineOrigin = detectTimelineOrigin(jsonData);
    const streamStartTime = detectStreamStartTime(jsonData);
    // Show rebase when the container reports a non-zero start, or frames sit off zero.
    const timelineOffsetVisible = streamStartTime > 0 || timelineOrigin > 0.05;
    let timelineRebased = false;

    function mediaUsesAbsolutePts() {
        // Native Chromium keeps absolute PTS when start_time != 0; ffmpeg→canvas is 0-based.
        return !isFfmpegPreview();
    }
    function mediaTimeToFramePts(mediaT) {
        const t = Number(mediaT);
        if (!Number.isFinite(t)) return t;
        return mediaUsesAbsolutePts() ? t : t + timelineOrigin;
    }
    function framePtsToMediaTime(pts) {
        const t = Number(pts);
        if (!Number.isFinite(t)) return t;
        return mediaUsesAbsolutePts() ? t : t - timelineOrigin;
    }
    function framePtsToChartX(pts) {
        const t = Number(pts);
        if (!Number.isFinite(t)) return t;
        return timelineRebased ? t - timelineOrigin : t;
    }
    function chartXToFramePts(x) {
        const t = Number(x);
        if (!Number.isFinite(t)) return t;
        return timelineRebased ? t + timelineOrigin : t;
    }
    function chartAxisMin() {
        return timelineRebased ? 0 : timelineOrigin;
    }
    function chartAxisMax() {
        const span = Number.isFinite(duration) && duration > 0 ? duration : 0;
        return chartAxisMin() + span;
    }
    function frameChartXs() {
        return jsonData.frames.map((f) => framePtsToChartX(parseFloat(f.best_effort_timestamp_time)));
    }

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

    function updateRebaseButton() {
        if (!rebaseBtn) return;
        if (!timelineOffsetVisible) {
            rebaseBtn.hidden = true;
            return;
        }
        rebaseBtn.hidden = false;
        const offsetLabel = formatTimelineOffsetLabel(timelineOrigin);
        if (timelineRebased) {
            rebaseBtn.classList.add('is-active');
            rebaseBtn.setAttribute('aria-pressed', 'true');
            rebaseBtn.textContent = `Rebased to 0 · was ${offsetLabel}`;
            rebaseBtn.title = 'Restore absolute presentation timestamps on the frame graph';
        } else {
            rebaseBtn.classList.remove('is-active');
            rebaseBtn.setAttribute('aria-pressed', 'false');
            rebaseBtn.textContent = `Rebase timeline · first PTS ${offsetLabel}`;
            rebaseBtn.title = 'Shift the frame graph so the first presentation timestamp is 0';
        }
    }

    function applyTimelineMode({ preserveZoom = false } = {}) {
        const chartDiv = document.getElementById('frameChart');
        updateRebaseButton();
        if (!chartDiv || typeof Plotly === 'undefined' || !chartDiv.data) return;
        const range = [chartAxisMin(), chartAxisMax()];
        if (layout) {
            layout.xaxis.range = range;
            layout.xaxis.autorange = false;
        }
        currentZoomLevel = 1;
        Plotly.restyle(chartDiv, { x: [frameChartXs()] }, [0]).then(() => {
            return Plotly.relayout(chartDiv, {
                'xaxis.range': range,
                'xaxis.autorange': false,
            });
        }).then(() => {
            syncPlayheadView(videoPlayer.currentTime, true);
        }).catch(() => {});
    }

    updateRebaseButton();
    if (rebaseBtn && !rebaseBtn._vidplotRebaseBound) {
        rebaseBtn._vidplotRebaseBound = true;
        rebaseBtn.addEventListener('click', () => {
            // Handler uses latest setupPlotlyChart closure via window hook
            if (typeof window.vidplotToggleTimelineRebase === 'function') {
                window.vidplotToggleTimelineRebase();
            }
        });
    }
    window.vidplotToggleTimelineRebase = () => {
        if (!timelineOffsetVisible) return;
        timelineRebased = !timelineRebased;
        applyTimelineMode({ preserveZoom: true });
    };

    // --- Playback Helpers (state on transport singleton) ---
    function stopReversePlayback() {
        transport.stopReverse();
    }

    function playBackwardAt(speed) {
        const rate = Math.max(1, Math.min(4, speed));
        stopReversePlayback();
        videoPlayer = media();
        transport.video = videoPlayer;
        // pause() fires a 'pause' listener that would clear shuttleRate before reverse starts
        transport.suppressPauseSideEffects = true;
        videoPlayer.pause();
        transport.suppressPauseSideEffects = false;
        let lastTs = performance.now();
        function tick(now) {
            videoPlayer = media();
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
        videoPlayer = media();
        transport.video = videoPlayer;
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
        // FFmpeg canvas adapter supports negative playbackRate in its play loop
        if (isFfmpegPreview()) {
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
        videoPlayer = media();
        transport.video = videoPlayer;
        if (transport.shuttleRate !== 0 || transport.reverseRafId !== null || !videoPlayer.paused) {
            pausePlayback();
        } else {
            const dur = Number(videoPlayer.duration);
            if (videoPlayer.ended || (Number.isFinite(dur) && dur > 0 && videoPlayer.currentTime >= dur - 0.05)) {
                try {
                    if (typeof videoPlayer.fastSeek === "function") videoPlayer.fastSeek(0);
                    else videoPlayer.currentTime = 0;
                } catch (_) {
                    videoPlayer.currentTime = 0;
                }
            }
            applyShuttle(1);
        }
    }

    // --- Zoom Helpers ---
    function getZoomCenter() {
        if (layout.xaxis.range) {
            return (layout.xaxis.range[0] + layout.xaxis.range[1]) / 2;
        }
        return framePtsToChartX(mediaTimeToFramePts(videoPlayer.currentTime))
            || (chartAxisMin() + duration / 2);
    }
    function clampZoomRange(center, visibleDuration) {
        const axisMin = chartAxisMin();
        const axisMax = chartAxisMax();
        const half = visibleDuration / 2;
        let min = center - half;
        let max = center + half;
        if (min < axisMin) {
            min = axisMin;
            max = Math.min(axisMax, axisMin + visibleDuration);
        }
        if (max > axisMax) {
            max = axisMax;
            min = Math.max(axisMin, axisMax - visibleDuration);
        }
        return [min, max];
    }
    function applyZoomLevel(zoomLevel, centerTime) {
        const level = Math.max(1, Math.min(maxZoom, zoomLevel));
        let range;
        if (level <= 1) {
            range = [chartAxisMin(), chartAxisMax()];
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
                x: frameChartXs(),
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
            range: [chartAxisMin(), chartAxisMax()],
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
        const pts = chartXToFramePts(clickedTime);
        const t = framePtsToMediaTime(pts);
        const maxT = effectiveDuration();
        const mediaT = Math.max(0, Math.min(maxT === Infinity ? t : maxT, t));
        if (!Number.isFinite(mediaT)) return;
        if (transport.shuttleRate < 0) pausePlayback();
        seekToTime(mediaT, true);
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
                range = [chartAxisMin(), chartAxisMax()];
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
    function onMediaTimeUpdate() {
        if (transport.reverseRafId !== null) return;
        syncPlayheadView(videoPlayer.currentTime, false);
    }
    if (typeof videoPlayer.addEventListener === 'function') {
        videoPlayer.addEventListener('timeupdate', onMediaTimeUpdate);
    } else {
        videoPlayer.ontimeupdate = onMediaTimeUpdate;
    }
    function onMediaEnded() {
        transport.shuttleRate = 0;
        videoPlayer.playbackRate = 1;
    }
    if (typeof videoPlayer.addEventListener === 'function') {
        videoPlayer.addEventListener('ended', onMediaEnded);
    } else {
        videoPlayer.onended = onMediaEnded;
    }

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
        // Must check before releaseVidplotShortcutFocus — blurring first made the
        // typing-target guard always fail and J/K/L stole chars from form fields.
        if (isVidplotTypingTarget(document.activeElement)) return;
        if (document.querySelector('.load-choice-dialog:not([hidden])')) return;
        releaseVidplotShortcutFocus();
        // Space/K must not auto-repeat (would toggle/pause-spam); J/L and frame step may
        if (e.repeat && (key === ' ' || key === 'Spacebar' || code === 'Space' || lower === 'k')) return;

        e._vidplotHandled = true;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
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
