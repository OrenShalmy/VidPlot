/**
 * Hybrid media surface: native <video> or ffmpeg→canvas JPEG frames.
 * Consumers should use window.vidplotGetMedia() instead of #videoPlayer alone.
 */
(function () {
    const HAVE_CURRENT_DATA = 2;
    const HAVE_ENOUGH_DATA = 4;

    function getTransport() {
        if (typeof getVidplotTransport === "function") {
            return getVidplotTransport();
        }
        if (!window._vidplotTransport) {
            window._vidplotTransport = {
                video: null,
                api: null,
                reverseRafId: null,
                shuttleRate: 0,
                suppressPauseSideEffects: false,
                mediaNeedsWake: false,
                onPlay: null,
                onPause: null,
                onKeyDown: null,
                stopReverse() {},
                teardown() {},
            };
        }
        return window._vidplotTransport;
    }

    function estimateFps(jsonData) {
        if (typeof estimateJsonFps === "function") {
            return estimateJsonFps(jsonData);
        }
        return 25;
    }

    function createEventTarget() {
        const listeners = new Map();
        return {
            addEventListener(type, fn) {
                if (typeof fn !== "function") return;
                if (!listeners.has(type)) listeners.set(type, new Set());
                listeners.get(type).add(fn);
            },
            removeEventListener(type, fn) {
                const set = listeners.get(type);
                if (set) set.delete(fn);
            },
            dispatch(type) {
                const set = listeners.get(type);
                if (!set) return;
                const evt = { type, target: this };
                set.forEach((fn) => {
                    try {
                        fn.call(this, evt);
                    } catch (err) {
                        console.error(err);
                    }
                });
            },
        };
    }

    function createNativeAdapter(video) {
        return video;
    }

    function createFfmpegAdapter({ video, canvas, path, duration, fps, initialTime = 0 }) {
        const events = createEventTarget();
        let currentTime = 0;
        let paused = true;
        let playbackRate = 1;
        let fetchToken = 0;
        let abortController = null;
        let playRaf = null;
        let lastPlayTs = 0;
        let inFlight = false;
        let pendingTime = null;
        let seekDebounce = null;
        let destroyed = false;
        const maxT = (Number.isFinite(duration) && duration > 0) ? duration : Infinity;

        function showCanvas() {
            if (canvas) {
                canvas.hidden = false;
                canvas.style.display = "block";
            }
            if (video) {
                video.pause();
                video.removeAttribute("src");
                if (video.querySelector("source")) {
                    video.querySelector("source").removeAttribute("src");
                }
                try {
                    video.load();
                } catch (_) { /* ignore */ }
                video.style.display = "none";
                video.hidden = true;
            }
        }

        function drawBlob(blob) {
            return createImageBitmap(blob).then((bitmap) => {
                if (destroyed || !canvas) {
                    bitmap.close();
                    return;
                }
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    bitmap.close();
                    return;
                }
                if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
                    canvas.width = bitmap.width;
                    canvas.height = bitmap.height;
                }
                ctx.drawImage(bitmap, 0, 0);
                bitmap.close();
            });
        }

        function fetchFrame(time, opts) {
            const force = opts && opts.force;
            const fireSeeked = !opts || opts.seeked !== false;
            if (!path || destroyed) return Promise.resolve();
            if (inFlight && !force) {
                pendingTime = time;
                return Promise.resolve();
            }
            if (abortController) abortController.abort();
            abortController = new AbortController();
            const token = ++fetchToken;
            inFlight = true;
            const width = Math.max(
                320,
                Math.min(1920, Math.round((canvas?.clientWidth || 960) * (window.devicePixelRatio || 1)))
            );
            const input = (window.vidplotInputByPath && window.vidplotInputByPath[path])
                || window.vidplotJsonData?.format?.vidplot_input
                || null;
            return fetch("/api/preview-frame", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    path,
                    time,
                    width,
                    ...(input ? { input } : {}),
                }),
                signal: abortController.signal,
            })
                .then(async (res) => {
                    if (token !== fetchToken) return;
                    if (!res.ok) {
                        let details = "Preview frame failed";
                        try {
                            const err = await res.json();
                            details = err.details || err.error || details;
                        } catch (_) { /* ignore */ }
                        throw new Error(details);
                    }
                    return res.blob();
                })
                .then((blob) => {
                    if (token !== fetchToken || !blob) return;
                    return drawBlob(blob);
                })
                .then(() => {
                    if (token !== fetchToken) return;
                    if (fireSeeked) events.dispatch("seeked");
                    events.dispatch("timeupdate");
                })
                .catch((err) => {
                    if (err && err.name === "AbortError") return;
                    if (token !== fetchToken) return;
                    console.error("preview frame:", err);
                })
                .finally(() => {
                    if (token === fetchToken) inFlight = false;
                    if (pendingTime !== null && !destroyed) {
                        const next = pendingTime;
                        pendingTime = null;
                        fetchFrame(next, { seeked: true });
                    }
                });
        }

        function setCurrentTime(t, opts) {
            const clamped = Math.max(0, Math.min(maxT === Infinity ? t : maxT, Number(t) || 0));
            currentTime = clamped;
            if (seekDebounce) clearTimeout(seekDebounce);
            const delay = (opts && opts.immediate) ? 0 : 40;
            seekDebounce = setTimeout(() => {
                seekDebounce = null;
                fetchFrame(currentTime, { seeked: true });
            }, delay);
        }

        function stopPlayLoop() {
            if (playRaf !== null) {
                cancelAnimationFrame(playRaf);
                playRaf = null;
            }
            lastPlayTs = 0;
        }

        function playLoop(ts) {
            if (destroyed || paused) {
                playRaf = null;
                return;
            }
            if (!lastPlayTs) lastPlayTs = ts;
            // Advance by wall-clock time only (not frameDt). Using max(frameDt, elapsed)
            // made 25fps content run ~2.4× realtime because rAF fires ~60Hz.
            const elapsed = Math.max(0, (ts - lastPlayTs) / 1000);
            lastPlayTs = ts;
            const dt = Math.min(elapsed, 0.25) * Math.max(0.25, Math.abs(playbackRate) || 1);
            let next = currentTime + (playbackRate >= 0 ? dt : -dt);
            if (next >= maxT) {
                currentTime = maxT === Infinity ? currentTime : maxT;
                paused = true;
                stopPlayLoop();
                fetchFrame(currentTime, { seeked: true }).then(() => {
                    events.dispatch("pause");
                    events.dispatch("ended");
                });
                return;
            }
            if (next < 0) {
                currentTime = 0;
                paused = true;
                stopPlayLoop();
                fetchFrame(0, { seeked: true }).then(() => events.dispatch("pause"));
                return;
            }
            currentTime = next;
            if (!inFlight) {
                fetchFrame(currentTime, { seeked: false });
            } else {
                pendingTime = currentTime;
                events.dispatch("timeupdate");
            }
            playRaf = requestAnimationFrame(playLoop);
        }

        showCanvas();
        const startT = Math.max(0, Number(initialTime) || 0);
        currentTime = Math.min(maxT === Infinity ? startT : maxT, startT);
        fetchFrame(currentTime, { seeked: true, force: true }).then(() => {
            events.dispatch("loadedmetadata");
            events.dispatch("loadeddata");
        });

        const api = {
            get currentTime() {
                return currentTime;
            },
            set currentTime(t) {
                setCurrentTime(t, { immediate: false });
            },
            get duration() {
                return maxT === Infinity ? NaN : maxT;
            },
            get paused() {
                return paused;
            },
            get ended() {
                return Number.isFinite(maxT) && currentTime >= maxT && paused;
            },
            get playbackRate() {
                return playbackRate;
            },
            set playbackRate(r) {
                const n = Number(r);
                playbackRate = Number.isFinite(n) && n !== 0 ? n : 1;
            },
            get readyState() {
                return canvas && canvas.width ? HAVE_ENOUGH_DATA : HAVE_CURRENT_DATA;
            },
            get dataset() {
                return video ? video.dataset : {};
            },
            get videoWidth() {
                return canvas ? canvas.width : 0;
            },
            get videoHeight() {
                return canvas ? canvas.height : 0;
            },
            play() {
                if (destroyed) return Promise.resolve();
                if (!paused) return Promise.resolve();
                // Replay from start when already at the last frame
                if (Number.isFinite(maxT) && maxT > 0 && currentTime >= maxT - 1e-3) {
                    currentTime = 0;
                }
                paused = false;
                events.dispatch("play");
                lastPlayTs = 0;
                stopPlayLoop();
                playRaf = requestAnimationFrame(playLoop);
                return Promise.resolve();
            },
            pause() {
                if (paused) return;
                paused = true;
                stopPlayLoop();
                events.dispatch("pause");
                fetchFrame(currentTime, { seeked: true });
            },
            fastSeek(t) {
                setCurrentTime(t, { immediate: true });
            },
            load() {},
            addEventListener(type, fn) {
                events.addEventListener(type, fn);
            },
            removeEventListener(type, fn) {
                events.removeEventListener(type, fn);
            },
            seekTo(t, immediate) {
                setCurrentTime(t, { immediate: !!immediate });
            },
            destroy() {
                destroyed = true;
                stopPlayLoop();
                if (seekDebounce) clearTimeout(seekDebounce);
                if (abortController) abortController.abort();
                fetchToken += 1;
            },
            _vidplotMode: "ffmpeg",
            _vidplotCanvas: canvas,
            _vidplotPath: path,
        };

        // Alias so code that assigns ontimeupdate still works
        Object.defineProperty(api, "ontimeupdate", {
            set(fn) {
                api._ontimeupdate = fn;
                if (fn) {
                    events.addEventListener("timeupdate", fn);
                }
            },
            get() {
                return api._ontimeupdate || null;
            },
        });
        Object.defineProperty(api, "onended", {
            set(fn) {
                api._onended = fn;
                if (fn) events.addEventListener("ended", fn);
            },
            get() {
                return api._onended || null;
            },
        });

        return api;
    }

    function setPreviewVisibility(mode, video, canvas) {
        if (mode === "ffmpeg") {
            if (canvas) {
                canvas.hidden = false;
                canvas.style.display = "block";
            }
            if (video) {
                video.hidden = true;
                video.style.display = "none";
            }
        } else {
            if (canvas) {
                canvas.hidden = true;
                canvas.style.display = "none";
            }
            if (video) {
                video.hidden = false;
                video.style.display = "block";
            }
        }
    }

    const slotAdapters = { A: null, B: null };

    // ---- Compare frame lock -------------------------------------------------
    // A is index-truth. A ref index always means "A's frame N"; B is resolved as
    // N + offsetFrames against B's OWN timestamp table.
    //
    // The two preview paths round a seek in OPPOSITE directions, and sit on
    // different time bases. Both were measured, not assumed:
    //
    //   native <video>  floor  (shows the frame whose interval contains t)
    //                   absolute container timeline (Chrome does NOT normalise
    //                   a non-zero start_time; currentTime reads 5.0167 on a
    //                   file whose first PTS is 5.0)
    //   ffmpeg -> canvas  ceiling (app.py seeks `-ss t` BEFORE -i, which yields
    //                   the first frame with PTS >= t)
    //                   start_time-relative (ffmpeg's -ss is relative to the
    //                   container start, so absolute PTS must be rebased)
    //
    // So a single shared "mid frame" time cannot serve both: forward-nudging the
    // ffmpeg path lands on N+1 every time, backward-nudging the native path
    // lands on N-1 every time. Resolution is per-slot and path-aware.
    function slotJson(slot) {
        return (typeof window.vidplotGetCompareSlot === "function"
            && window.vidplotGetCompareSlot(slot)?.jsonData) || null;
    }

    // Presentation timestamps for a slot, as plain numbers.
    //
    // Prefers the full decoded frame table when it has landed, but falls back to
    // the cheap packet-PTS probe (/api/frame-times, cached on the slot). The
    // full table costs a whole-file decode -- 86 s to 185 s on a 7-minute 1080p
    // broadcast file -- and the lock needs nothing from it but these numbers.
    function slotPts(slot) {
        const json = slotJson(slot);
        const frames = json?.frames;
        if (Array.isArray(frames) && frames.length && !json.frames_pending) {
            const out = new Array(frames.length);
            for (let i = 0; i < frames.length; i += 1) {
                out[i] = parseFloat(frames[i].best_effort_timestamp_time);
            }
            return out;
        }
        const fast = window.vidplotGetCompareSlot?.(slot)?.frameTimes;
        return Array.isArray(fast) && fast.length ? fast : null;
    }

    // Container start offset for a slot, in seconds. Only the ffmpeg path needs
    // it; the native path already speaks the absolute timeline.
    function slotStartTime(slot) {
        const json = slotJson(slot);
        if (!json) return 0;
        const vid = (json.streams || []).find((st) => st.codec_type === "video");
        const raw = vid?.start_time ?? json.format?.start_time;
        const v = parseFloat(raw);
        return Number.isFinite(v) ? v : 0;
    }

    // Local interval around frame i, from this slot's own timestamps.
    // Deliberately NOT a global frameDuration (pts[1]-pts[0]), which is CFR-only
    // and wrong if the stream opens with reordering or an edit list.
    function frameInterval(pts, i) {
        const here = pts[i];
        const next = i + 1 < pts.length ? pts[i + 1] : NaN;
        if (Number.isFinite(here) && Number.isFinite(next) && next > here) return next - here;
        const prev = i > 0 ? pts[i - 1] : NaN;
        if (Number.isFinite(here) && Number.isFinite(prev) && here > prev) return here - prev;
        return 1 / 30;
    }

    function clampIdx(pts, i) {
        return Math.max(0, Math.min(pts.length - 1, i));
    }

    function isFfmpegSlot(api) {
        return !!api && api._vidplotMode === "ffmpeg";
    }

    // Resolve a ref index into the seek time for one slot.
    function resolveSlotTime(slot, api, pts, idx) {
        const i = clampIdx(pts, idx);
        const t = pts[i];
        if (!Number.isFinite(t)) return null;
        const iv = frameInterval(pts, i);
        if (isFfmpegSlot(api)) {
            // ceiling semantics: aim half a frame BELOW, rebased to the
            // container start. Survives app.py's `-ss {t:.3f}` quantisation
            // (verified 200/200 at 30p, 300/300 at 59.94p).
            return Math.max(0, t - slotStartTime(slot) - iv / 2);
        }
        // floor semantics: aim half a frame ABOVE, absolute timeline.
        return t + iv / 2;
    }

    function lockOffsetFrames() {
        const v = parseInt(window.vidplotCompare?.offsetFrames, 10);
        return Number.isFinite(v) ? v : 0;
    }

    function frameLockState() {
        const ptsA = slotPts("A");
        const ptsB = slotPts("B");
        if (!ptsA || !ptsB) return { ready: false, reason: "frame times not ready" };
        return { ready: true, reason: "", ptsA, ptsB };
    }

    function offsetSeconds() {
        // Scalar seconds equivalent of the frame offset, for the playback-time
        // drift corrector (frame-exactness during playback is out of scope).
        const st = frameLockState();
        if (!st.ready) return 0;
        const off = lockOffsetFrames();
        if (!off) return 0;
        return off * frameInterval(st.ptsA, 0);
    }

    window.vidplotCompareFrameLockState = frameLockState;
    window.vidplotCompareOffsetSeconds = offsetSeconds;

    let singleSnapshot = null;

    function createCompareSyncAdapter(apiA, apiB) {
        const events = createEventTarget();
        const master = apiA || apiB;
        let lastRefIdx = null;
        let lockAssertTimer = null;

        // The pause re-assert is deferred (it has to let the pause settle), so
        // any seek issued in the meantime must cancel it. stepFrame() calls
        // pausePlayback() BEFORE it seeks, so without this the stale re-assert
        // lands after the step and pins the playhead to the previous frame --
        // stepping silently stops working.
        function cancelLockAssert() {
            if (lockAssertTimer) {
                clearTimeout(lockAssertTimer);
                lockAssertTimer = null;
            }
        }

        function both(fn) {
            if (apiA && fn) {
                try {
                    fn(apiA);
                } catch (err) {
                    console.error(err);
                }
            }
            if (apiB && fn) {
                try {
                    fn(apiB);
                } catch (err) {
                    console.error(err);
                }
            }
        }

        function minDuration() {
            const da = Number(apiA?.duration);
            const db = Number(apiB?.duration);
            if (Number.isFinite(da) && da > 0 && Number.isFinite(db) && db > 0) {
                return Math.min(da, db);
            }
            if (Number.isFinite(da) && da > 0) return da;
            if (Number.isFinite(db) && db > 0) return db;
            return 0;
        }

        // Where is the playhead, in A-index terms? Inverts resolveSlotTime by
        // construction, so it is correct for either preview path rather than
        // assuming the landing time equals the PTS.
        function refIdxNow() {
            const st = frameLockState();
            if (!st.ready || !apiA) return null;
            const pts = st.ptsA;
            const t = Number(apiA.currentTime);
            if (!Number.isFinite(t)) return null;
            const p0 = pts[0];
            const iv = frameInterval(pts, 0);
            if (!Number.isFinite(p0) || !(iv > 0)) return null;
            // Coarse estimate, then refine locally -- avoids scanning a long
            // frame table on every pause.
            const base = isFfmpegSlot(apiA) ? p0 - slotStartTime("A") : p0;
            let best = null;
            let bestErr = Infinity;
            const guess = Math.round((t - base) / iv);
            for (let i = guess - 3; i <= guess + 3; i += 1) {
                if (i < 0 || i >= pts.length) continue;
                const cand = resolveSlotTime("A", apiA, pts, i);
                if (cand == null) continue;
                const err = Math.abs(cand - t);
                if (err < bestErr) {
                    bestErr = err;
                    best = i;
                }
            }
            return best;
        }

        const api = {
            get currentTime() {
                return master ? master.currentTime : 0;
            },
            set currentTime(t) {
                lastRefIdx = null;
                cancelLockAssert();
                both((a) => {
                    if (typeof a.seekTo === "function") a.seekTo(t, true);
                    else a.currentTime = t;
                });
            },
            get duration() {
                return minDuration();
            },
            get paused() {
                if (apiA && !apiA.paused) return false;
                if (apiB && !apiB.paused) return false;
                return true;
            },
            get ended() {
                const d = minDuration();
                return d > 0 && api.currentTime >= d - 0.001 && api.paused;
            },
            get playbackRate() {
                return master ? master.playbackRate : 1;
            },
            set playbackRate(r) {
                both((a) => { a.playbackRate = r; });
            },
            get readyState() {
                return master ? master.readyState : 0;
            },
            get dataset() {
                return master?.dataset || {};
            },
            get videoWidth() {
                return master ? master.videoWidth : 0;
            },
            get videoHeight() {
                return master ? master.videoHeight : 0;
            },
            play() {
                // Playback moves the playhead without going through any seek,
                // so a tracked ref index goes stale the moment we start. Drop
                // it: pause() then derives the frame actually reached, instead
                // of re-asserting the frame play STARTED from (which rewinds).
                lastRefIdx = null;
                cancelLockAssert();
                return Promise.all([
                    apiA ? apiA.play() : Promise.resolve(),
                    apiB ? apiB.play() : Promise.resolve(),
                ]).then(() => undefined);
            },
            pause() {
                both((a) => a.pause());
                // The drift corrector only guarantees B is within 60 ms of
                // target, so on pause B is parked one to three frames off.
                // Re-assert the exact lock once the pause has settled.
                //
                // Hung off pause() rather than the 'pause' event on purpose:
                // the event path runs through transport.onPause and the
                // suppressPauseSideEffects guard in plotly.js, and re-entering
                // that is how you get a seek fight.
                //
                // NOTE: stepFrame() calls pausePlayback() BEFORE it seeks, so
                // every step schedules a re-assert to the frame we are about to
                // leave. That is not merely redundant -- if it lands after the
                // step's own seek it pins the playhead and stepping silently
                // stops working (observed: ref index stuck across 8 steps).
                // cancelLockAssert() in every seek path is what makes it safe.
                // Do not drop the re-assert either; it is what keeps a plain
                // pause frame-exact.
                const idx = lastRefIdx != null ? lastRefIdx : refIdxNow();
                if (idx != null) {
                    cancelLockAssert();
                    lockAssertTimer = setTimeout(() => {
                        lockAssertTimer = null;
                        if (!api.paused) return;
                        api.seekToFrame(idx, true);
                    }, 0);
                }
            },
            fastSeek(t) {
                lastRefIdx = null;
                cancelLockAssert();
                both((a) => {
                    if (typeof a.fastSeek === "function") a.fastSeek(t);
                    else if (typeof a.seekTo === "function") a.seekTo(t, true);
                    else a.currentTime = t;
                });
            },
            load() {},
            addEventListener(type, fn) {
                events.addEventListener(type, fn);
                if (master) master.addEventListener(type, fn);
            },
            removeEventListener(type, fn) {
                events.removeEventListener(type, fn);
                if (master) master.removeEventListener(type, fn);
            },
            seekTo(t, immediate) {
                // A time-based seek (chart click, arrow key, shuttle) makes the
                // tracked ref index stale -- drop it so it gets re-derived.
                lastRefIdx = null;
                cancelLockAssert();
                both((a) => {
                    if (typeof a.seekTo === "function") a.seekTo(t, immediate);
                    else a.currentTime = t;
                });
            },
            // Frame-exact counterpart to seekTo: each slot resolves the ref
            // index against its own table, so neither a start_time difference
            // nor the two paths' opposite rounding can smear the landing.
            seekToFrame(refIdx, immediate) {
                cancelLockAssert();
                const st = frameLockState();
                if (!st.ready) return false;
                const off = lockOffsetFrames();
                const tA = resolveSlotTime("A", apiA, st.ptsA, refIdx);
                const tB = resolveSlotTime("B", apiB, st.ptsB, refIdx + off);
                if (apiA && tA != null) {
                    if (typeof apiA.seekTo === "function") apiA.seekTo(tA, immediate);
                    else apiA.currentTime = tA;
                }
                if (apiB && tB != null) {
                    if (typeof apiB.seekTo === "function") apiB.seekTo(tB, immediate);
                    else apiB.currentTime = tB;
                }
                lastRefIdx = refIdx;
                return true;
            },
            get _vidplotRefIdx() {
                return lastRefIdx != null ? lastRefIdx : refIdxNow();
            },
            _vidplotMode: "compare-sync",
        };

        if (master) {
            master.addEventListener("timeupdate", () => {
                events.dispatch("timeupdate");
                if (apiA && apiB && apiA !== apiB) {
                    // The corrector has to know about the intended separation,
                    // otherwise the offset itself reads as drift: anything over
                    // the 60 ms threshold gets slammed back onto A's exact time
                    // on the first timeupdate (~4 Hz), and anything under it
                    // survives only until natural drift pushes the sum past
                    // threshold -- which is why small offsets appeared to work
                    // intermittently. Seconds, not frames: preserving the lock
                    // is the goal here, not frame-exactness while running.
                    const target = (apiA.currentTime || 0) + offsetSeconds();
                    const drift = Math.abs((apiB.currentTime || 0) - target);
                    if (drift > 0.06 && typeof apiB.seekTo === "function") {
                        apiB.seekTo(target, false);
                    }
                }
            });
            master.addEventListener("seeked", () => events.dispatch("seeked"));
            master.addEventListener("play", () => events.dispatch("play"));
            master.addEventListener("pause", () => events.dispatch("pause"));
            master.addEventListener("ended", () => events.dispatch("ended"));
        }

        return api;
    }

    function destroySlotAdapter(slot) {
        const api = slotAdapters[slot];
        if (api && typeof api.destroy === "function") {
            api.destroy();
        }
        slotAdapters[slot] = null;
    }

    function bindCompareTransport() {
        const transport = getTransport();
        const sync = createCompareSyncAdapter(slotAdapters.A, slotAdapters.B);
        transport.api = sync;
        transport.video = sync;
        window.vidplotMedia = sync;
    }

    /**
     * Enable preview for compare slot A or B (separate DOM elements).
     */
    function vidplotEnableSlotPreviewMode(slot, opts) {
        const s = slot === "B" ? "B" : "A";
        const video = opts?.video || document.getElementById(s === "B" ? "videoPlayerB" : "videoPlayerA");
        const canvas = opts?.canvas || document.getElementById(s === "B" ? "previewCanvasB" : "previewCanvasA");
        const source = opts?.source;
        const mode = opts?.mode === "ffmpeg" ? "ffmpeg" : "native";
        const path = opts?.path || "";
        const duration = Number(opts?.duration);
        const fps = Number(opts?.fps) || estimateFps(opts?.jsonData);
        const initialTime = Number(opts?.initialTime) || 0;
        const videoUrl = opts?.videoUrl;

        destroySlotAdapter(s);

        setPreviewVisibility(mode, video, canvas);

        let api;
        if (mode === "ffmpeg") {
            api = createFfmpegAdapter({
                video,
                canvas,
                path,
                duration: Number.isFinite(duration) && duration > 0
                    ? duration
                    : parseFloat(opts?.jsonData?.format?.duration) || NaN,
                fps,
                initialTime,
            });
            if (video) video.dataset.vidplotSource = path;
            if (canvas) canvas.dataset.vidplotSource = path;
        } else {
            if (source && videoUrl) {
                source.src = videoUrl;
            }
            if (video) {
                video.hidden = false;
                video.style.display = "block";
                video.dataset.vidplotSource = path;
                if (initialTime > 0) {
                    video.addEventListener("loadeddata", () => {
                        try {
                            video.currentTime = initialTime;
                        } catch (_) { /* ignore */ }
                    }, { once: true });
                }
                video.load();
            }
            api = createNativeAdapter(video);
        }

        slotAdapters[s] = api;
        if (window.vidplotCompare?.enabled) {
            bindCompareTransport();
        }
        return api;
    }

    function vidplotDestroySlotPreview(slot) {
        destroySlotAdapter(slot === "B" ? "B" : "A");
        if (window.vidplotCompare?.enabled) {
            bindCompareTransport();
        }
    }

    function vidplotSnapshotSinglePreview() {
        const m = vidplotGetMedia();
        singleSnapshot = {
            mode: window.vidplotPreviewMode || "native",
            path: window.vidplotCurrentSourcePath || "",
            duration: parseFloat(window.vidplotJsonData?.format?.duration) || NaN,
            jsonData: window.vidplotJsonData,
            videoUrl: window.vidplotCurrentVideoUrl || "",
            initialTime: m?.currentTime || 0,
        };
    }

    function vidplotRestoreSinglePreview() {
        if (!singleSnapshot) return;
        const snap = { ...singleSnapshot };
        singleSnapshot = null;
        destroySlotAdapter("A");
        destroySlotAdapter("B");
        const video = document.getElementById("videoPlayer");
        const canvas = document.getElementById("previewCanvas");
        const source = document.getElementById("videoSource");
        if (source && snap.videoUrl) {
            source.src = snap.videoUrl;
        }
        vidplotEnablePreviewMode({
            ...snap,
            initialTime: snap.initialTime,
        });
        if (Number.isFinite(snap.initialTime) && snap.initialTime > 0) {
            const m = vidplotGetMedia();
            if (m) {
                if (typeof m.seekTo === "function") m.seekTo(snap.initialTime, true);
                else m.currentTime = snap.initialTime;
            }
        }
    }

    function vidplotBindCompareTransport() {
        if (window.vidplotCompare?.enabled) {
            bindCompareTransport();
        }
    }

    /**
     * Activate native or ffmpeg preview for the current source.
     * @param {{ mode: 'native'|'ffmpeg', path: string, duration?: number, fps?: number, jsonData?: object }} opts
     */
    function vidplotEnablePreviewMode(opts) {
        if (window.vidplotCompare?.enabled) {
            return vidplotEnableSlotPreviewMode("A", {
                ...opts,
                video: document.getElementById("videoPlayerA"),
                canvas: document.getElementById("previewCanvasA"),
                source: document.getElementById("videoSourceA"),
                videoUrl: opts?.videoUrl,
            });
        }

        const video = document.getElementById("videoPlayer");
        const canvas = document.getElementById("previewCanvas");
        const mode = opts?.mode === "ffmpeg" ? "ffmpeg" : "native";
        const path = opts?.path || window.vidplotCurrentSourcePath || "";
        const videoUrl = opts?.videoUrl;
        const duration = Number(opts?.duration);
        const initialTime = Number(opts?.initialTime) || 0;
        const fps = Number(opts?.fps) || estimateFps(opts?.jsonData || window.vidplotJsonData);
        const transport = getTransport();

        if (transport.api && typeof transport.api.destroy === "function") {
            transport.api.destroy();
        }

        singleSnapshot = { ...opts, videoUrl: opts?.videoUrl };

        window.vidplotPreviewMode = mode;
        setPreviewVisibility(mode, video, canvas);

        let api;
        if (mode === "ffmpeg") {
            api = createFfmpegAdapter({
                video,
                canvas,
                path,
                duration: Number.isFinite(duration) && duration > 0
                    ? duration
                    : parseFloat(window.vidplotJsonData?.format?.duration) || NaN,
                fps,
                initialTime,
            });
            if (video) video.dataset.vidplotSource = path;
            if (canvas) canvas.dataset.vidplotSource = path;
        } else {
            api = createNativeAdapter(video);
            if (video && Number.isFinite(initialTime) && initialTime > 0) {
                video.addEventListener("loadeddata", () => {
                    try {
                        video.currentTime = initialTime;
                    } catch (_) { /* ignore */ }
                }, { once: true });
            }
            if (video) {
                video.hidden = false;
                video.style.display = "block";
                video.dataset.vidplotSource = path;
            }
        }

        transport.api = api;
        transport.video = api;
        window.vidplotMedia = api;
        return api;
    }

    function vidplotGetMedia(slot) {
        if (slot === "A" || slot === "B") {
            return slotAdapters[slot] || null;
        }
        if (window.vidplotCompare?.enabled) {
            const transport = getTransport();
            if (transport.api) return transport.api;
        }
        const transport = getTransport();
        if (transport.api) return transport.api;
        if (window.vidplotMedia) return window.vidplotMedia;
        return document.getElementById("videoPlayer");
    }

    window.vidplotEnablePreviewMode = vidplotEnablePreviewMode;
    window.vidplotEnableSlotPreviewMode = vidplotEnableSlotPreviewMode;
    window.vidplotDestroySlotPreview = vidplotDestroySlotPreview;
    window.vidplotSnapshotSinglePreview = vidplotSnapshotSinglePreview;
    window.vidplotRestoreSinglePreview = vidplotRestoreSinglePreview;
    window.vidplotBindCompareTransport = vidplotBindCompareTransport;
    window.vidplotGetMedia = vidplotGetMedia;
    window.vidplotPreviewMode = window.vidplotPreviewMode || "native";
})();
