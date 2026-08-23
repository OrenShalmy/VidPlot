document.addEventListener("DOMContentLoaded", function () {
    const videoEl = document.getElementById("videoPlayer");
    const stage = document.getElementById("videoStage");
    const preview = document.getElementById("scopePreview");
    const legendEl = document.getElementById("scopeLegend");
    const statusEl = document.getElementById("scopeStatus");
    const overlaysToggle = document.getElementById("scopeOverlaysToggle");
    const toggles = Array.from(document.querySelectorAll(".scope-toggle[data-scope]"));
    if (!videoEl || !stage || !preview || !toggles.length) return;

    const OVERLAYS_KEY = "vidplotScopeOverlays";
    let overlaysVisible = localStorage.getItem(OVERLAYS_KEY) !== "0";

    const SCOPE_LEGENDS = {
        oscilloscope: {
            title: "Oscilloscope",
            x: "Sample position along trace",
            y: "Signal level",
        },
        waveform: {
            title: "Waveform",
            x: "Horizontal position (left → right)",
            y: "Luma level (black → white)",
        },
        rgbparade: {
            title: "RGB parade",
            x: "Horizontal position (left → right)",
            y: "Channel level (full digital range)",
            channels: [
                { name: "R", color: "#ff5a5a" },
                { name: "G", color: "#5dff7a" },
                { name: "B", color: "#5aa7ff" },
            ],
        },
        histogram: {
            title: "Histogram",
            x: "Level (full digital range)",
            y: "Pixel count",
            channels: [
                { name: "R", color: "#ff5a5a" },
                { name: "G", color: "#5dff7a" },
                { name: "B", color: "#5aa7ff" },
            ],
        },
        vectorscope: {
            title: "Vectorscope",
            x: "U / Cb (green ← → magenta)",
            y: "V / Cr (blue ← → yellow)",
            note: "Center — low saturation · Edges — high saturation",
        },
        motion: {
            title: "Motion vectors",
            x: "Frame X",
            y: "Frame Y",
            note: "Arrows show predicted motion",
        },
        qpmap: {
            title: "QP map",
            x: "Frame X",
            y: "Frame Y",
            channels: [
                { name: "Low QP", color: "#5dff7a" },
                { name: "High QP", color: "#ffffff" },
            ],
        },
    };

    // Full-frame analysis scopes — show live video as a top-right PiP reference
    const SCOPE_PIP = new Set(["waveform", "rgbparade", "histogram", "vectorscope"]);

    const active = new Set();
    let abortController = null;
    let objectUrl = null;
    const compareObjectUrls = { A: null, B: null };
    let requestToken = 0;
    let playTimer = null;
    let lastRequestKey = "";
    let boundMedia = null;

    function isCompareMode() {
        return typeof window.vidplotIsCompareMode === "function" && window.vidplotIsCompareMode();
    }

    function statusElement() {
        if (isCompareMode()) {
            return document.getElementById("scopeStatusCompare") || statusEl;
        }
        return statusEl;
    }

    function legendElement() {
        if (isCompareMode()) {
            return document.getElementById("scopeLegendCompare") || legendEl;
        }
        return legendEl;
    }

    function clampScopeTime(timeSec, jsonData) {
        let t = Number(timeSec);
        if (!Number.isFinite(t) || t < 0) t = 0;
        const data = jsonData || window.vidplotJsonData;
        const frames = data?.frames;
        if (Array.isArray(frames) && frames.length) {
            let lastPts = null;
            for (const frame of frames) {
                const pts = parseFloat(
                    frame.best_effort_timestamp_time
                    ?? frame.pkt_pts_time
                    ?? frame.pts_time
                );
                if (!Number.isFinite(pts)) continue;
                if (lastPts == null || pts > lastPts) lastPts = pts;
            }
            if (lastPts != null) return Math.min(t, lastPts);
        }
        const duration = Number(data?.format?.duration);
        if (Number.isFinite(duration) && duration > 0) {
            const stream = (data?.streams || []).find((s) => s.codec_type === "video");
            const rate = stream?.avg_frame_rate || stream?.r_frame_rate;
            let fps = 25;
            if (typeof rate === "string" && rate.includes("/")) {
                const [a, b] = rate.split("/").map(Number);
                if (b && a) fps = a / b;
            } else {
                const n = parseFloat(rate);
                if (Number.isFinite(n) && n > 0) fps = n;
            }
            return Math.min(t, Math.max(0, duration - (1 / fps)));
        }
        const mediaDur = Number(media()?.duration);
        if (Number.isFinite(mediaDur) && mediaDur > 0) {
            return Math.min(t, Math.max(0, mediaDur - 0.04));
        }
        return t;
    }

    function media() {
        return (typeof window.vidplotGetMedia === "function" && window.vidplotGetMedia()) || videoEl;
    }

    function setStatus(message, isError) {
        const el = statusElement();
        if (!el) return;
        if (!message) {
            el.hidden = true;
            el.textContent = "";
            el.classList.remove("is-error");
            return;
        }
        el.hidden = false;
        el.textContent = message;
        el.classList.toggle("is-error", !!isError);
    }

    function selectedFilters() {
        return toggles
            .filter((btn) => btn.getAttribute("aria-checked") === "true")
            .map((btn) => btn.dataset.scope)
            .filter(Boolean);
    }

    function updateScopePip(filters) {
        const names = filters || selectedFilters();
        const path = sourcePath();
        const m = media();
        const ffmpegMode = window.vidplotPreviewMode === "ffmpeg"
            || !!(m && m._vidplotMode === "ffmpeg");
        const canvas = document.getElementById("previewCanvas");
        let pictureReady = false;
        if (ffmpegMode) {
            // Canvas JPEG preview is the picture reference for ProRes / hard codecs
            pictureReady = !!(
                path
                && canvas
                && !canvas.hidden
                && canvas.width > 0
                && canvas.height > 0
                && (canvas.dataset.vidplotSource === path
                    || videoEl.dataset.vidplotSource === path)
            );
        } else {
            pictureReady = !!(
                path
                && videoEl.dataset.vidplotSource === path
                && videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
            );
        }
        const showPip = overlaysVisible
            && pictureReady
            && names.some((name) => SCOPE_PIP.has(name));
        stage.classList.toggle("has-scope-pip", showPip);
    }

    function syncOverlaysToggleUi() {
        if (!overlaysToggle) return;
        overlaysToggle.setAttribute("aria-checked", overlaysVisible ? "true" : "false");
        overlaysToggle.classList.toggle("is-active", overlaysVisible);
    }

    function updateLegend(filters) {
        const legend = legendElement();
        if (!legend) return;
        const names = (filters || []).filter((name) => SCOPE_LEGENDS[name]);
        if (!isCompareMode()) updateScopePip(filters || names);
        if (!names.length) {
            legend.hidden = true;
            legend.innerHTML = "";
            return;
        }
        legend.innerHTML = names.map((name) => {
            const info = SCOPE_LEGENDS[name];
            const channels = (info.channels || [])
                .map((ch) => (
                    `<span class="scope-legend-swatch">`
                    + `<i style="background:${ch.color}"></i>${ch.name}</span>`
                ))
                .join("");
            return (
                `<div class="scope-legend-block">`
                + `<div class="scope-legend-name">${info.title}</div>`
                + `<div class="scope-legend-axis"><span>X</span>${info.x}</div>`
                + `<div class="scope-legend-axis"><span>Y</span>${info.y}</div>`
                + (info.note ? `<div class="scope-legend-note">${info.note}</div>` : "")
                + (channels ? `<div class="scope-legend-channels">${channels}</div>` : "")
                + `</div>`
            );
        }).join("");
        legend.hidden = !overlaysVisible;
    }

    function sourcePath() {
        return window.vidplotJsonData?.format?.source_path
            || window.vidplotCurrentSourcePath
            || "";
    }

    function revokePreviewUrl() {
        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
        }
    }

    function revokeCompareUrls() {
        ["A", "B"].forEach((slot) => {
            if (compareObjectUrls[slot]) {
                URL.revokeObjectURL(compareObjectUrls[slot]);
                compareObjectUrls[slot] = null;
            }
        });
    }

    function clearPreview() {
        requestToken += 1;
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
        revokePreviewUrl();
        revokeCompareUrls();
        preview.removeAttribute("src");
        preview.hidden = true;
        stage.classList.remove("has-scopes");
        stage.classList.remove("has-scope-pip");
        ["A", "B"].forEach((slot) => {
            const img = document.getElementById(`scopePreview${slot}`);
            if (img) {
                img.removeAttribute("src");
                img.hidden = true;
            }
            const layer = document.querySelector(`.compare-layer[data-slot="${slot}"] .compare-media`);
            if (layer) layer.classList.remove("has-scopes");
        });
        const comparePane = document.getElementById("comparePane");
        if (comparePane) comparePane.classList.remove("has-scopes");
        updateLegend([]);
        setStatus("");
        lastRequestKey = "";
    }

    function syncToggleUi() {
        toggles.forEach((btn) => {
            const on = active.has(btn.dataset.scope);
            btn.setAttribute("aria-checked", on ? "true" : "false");
            btn.classList.toggle("is-active", on);
        });
        if (!active.size) clearPreview();
        else updateLegend(selectedFilters());
    }

    async function fetchScopeBlob(path, jsonData, time, filters, signal) {
        const res = await fetch("/api/scopes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                path,
                time: clampScopeTime(time, jsonData),
                filters,
            }),
            signal,
        });
        if (!res.ok) {
            let details = "Scope preview failed";
            try {
                const err = await res.json();
                details = err.details || err.error || details;
            } catch (_) { /* ignore */ }
            throw new Error(details);
        }
        return res.blob();
    }

    async function refreshScopes(force) {
        const filters = selectedFilters();
        if (!filters.length) {
            clearPreview();
            return;
        }
        updateLegend(filters);
        const m = media();
        const time = Number(m?.currentTime) || 0;

        if (isCompareMode()) {
            const slotA = window.vidplotGetCompareSlot?.("A");
            const slotB = window.vidplotGetCompareSlot?.("B");
            if (!slotA?.path || !slotB?.path) {
                setStatus("Both videos required for compare scopes", true);
                return;
            }
            const key = `cmp|${slotA.path}|${slotB.path}|${filters.join(",")}|${time.toFixed(2)}`;
            if (!force && key === lastRequestKey) return;
            lastRequestKey = key;

            if (abortController) abortController.abort();
            abortController = new AbortController();
            const token = ++requestToken;
            setStatus("Rendering scopes…");

            try {
                const [blobA, blobB] = await Promise.all([
                    fetchScopeBlob(slotA.path, slotA.jsonData, time, filters, abortController.signal),
                    fetchScopeBlob(slotB.path, slotB.jsonData, time, filters, abortController.signal),
                ]);
                if (token !== requestToken) return;
                revokeCompareUrls();
                compareObjectUrls.A = URL.createObjectURL(blobA);
                compareObjectUrls.B = URL.createObjectURL(blobB);
                const imgA = document.getElementById("scopePreviewA");
                const imgB = document.getElementById("scopePreviewB");
                if (imgA) {
                    imgA.src = compareObjectUrls.A;
                    imgA.hidden = false;
                }
                if (imgB) {
                    imgB.src = compareObjectUrls.B;
                    imgB.hidden = false;
                }
                document.querySelectorAll(".compare-media").forEach((el) => el.classList.add("has-scopes"));
                const comparePane = document.getElementById("comparePane");
                if (comparePane) comparePane.classList.add("has-scopes");
                setStatus("");
            } catch (err) {
                if (err && err.name === "AbortError") return;
                if (token !== requestToken) return;
                console.error(err);
                setStatus(err.message || "Scope preview failed", true);
            }
            return;
        }

        const path = sourcePath();
        if (!path) {
            setStatus("No source path for scopes", true);
            return;
        }
        const key = `${path}|${filters.join(",")}|${time.toFixed(2)}`;
        if (!force && key === lastRequestKey) return;
        lastRequestKey = key;

        if (abortController) abortController.abort();
        abortController = new AbortController();
        const token = ++requestToken;
        setStatus("Rendering scopes…");

        try {
            const blob = await fetchScopeBlob(path, window.vidplotJsonData, time, filters, abortController.signal);
            if (token !== requestToken) return;
            revokePreviewUrl();
            objectUrl = URL.createObjectURL(blob);
            preview.src = objectUrl;
            preview.hidden = false;
            stage.classList.add("has-scopes");
            setStatus("");
        } catch (err) {
            if (err && err.name === "AbortError") return;
            if (token !== requestToken) return;
            console.error(err);
            preview.hidden = true;
            stage.classList.remove("has-scopes");
            stage.classList.remove("has-scope-pip");
            setStatus(err.message || "Scope preview failed", true);
        }
    }

    function schedulePlayRefresh() {
        if (playTimer) return;
        playTimer = setTimeout(() => {
            playTimer = null;
            const m = media();
            if (m && !m.paused && active.size) refreshScopes(false);
        }, 350);
    }

    function onSeeked() {
        if (active.size) refreshScopes(true);
    }
    function onTimeUpdate() {
        const m = media();
        if (active.size && m && !m.paused) schedulePlayRefresh();
    }
    function onPause() {
        if (active.size) refreshScopes(true);
    }

    function bindMediaListeners() {
        const m = media();
        if (!m || m === boundMedia) return;
        if (boundMedia) {
            boundMedia.removeEventListener("seeked", onSeeked);
            boundMedia.removeEventListener("timeupdate", onTimeUpdate);
            boundMedia.removeEventListener("pause", onPause);
        }
        boundMedia = m;
        m.addEventListener("seeked", onSeeked);
        m.addEventListener("timeupdate", onTimeUpdate);
        m.addEventListener("pause", onPause);
    }

    toggles.forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const name = btn.dataset.scope;
            if (active.has(name)) active.delete(name);
            else active.add(name);
            syncToggleUi();
            if (active.size) refreshScopes(true);
        });
    });

    if (overlaysToggle) {
        overlaysToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            overlaysVisible = !overlaysVisible;
            try {
                localStorage.setItem(OVERLAYS_KEY, overlaysVisible ? "1" : "0");
            } catch (_) { /* ignore */ }
            syncOverlaysToggleUi();
            updateLegend(selectedFilters());
        });
    }

    document.querySelectorAll(".scope-switch-name").forEach((label) => {
        label.addEventListener("click", (e) => {
            e.stopPropagation();
            const btn = label.parentElement?.querySelector(".scope-toggle");
            if (btn) btn.click();
        });
    });

    // Default bind to native video; rebind when adapter activates
    bindMediaListeners();
    syncOverlaysToggleUi();

    window.vidplotResetScopes = function () {
        active.clear();
        syncToggleUi();
        clearPreview();
    };
    window.vidplotOnSourceReady = function (path) {
        lastRequestKey = "";
        if (path && videoEl) videoEl.dataset.vidplotSource = path;
        bindMediaListeners();
        if (active.size) {
            updateScopePip(selectedFilters());
            refreshScopes(true);
        }
    };
    window.vidplotOnCompareModeChange = function (enabled) {
        lastRequestKey = "";
        bindMediaListeners();
        if (!enabled) clearPreview();
        else if (active.size) refreshScopes(true);
    };

    window.vidplotRefreshScopes = function () {
        if (active.size) refreshScopes(true);
    };

    videoEl.addEventListener("loadeddata", () => {
        if (active.size) updateScopePip(selectedFilters());
    });

    syncToggleUi();
});
