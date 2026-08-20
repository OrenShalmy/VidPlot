document.addEventListener("DOMContentLoaded", function () {
    const videoEl = document.getElementById("videoPlayer");
    const stage = document.getElementById("videoStage");
    const preview = document.getElementById("scopePreview");
    const legendEl = document.getElementById("scopeLegend");
    const statusEl = document.getElementById("scopeStatus");
    const toggles = Array.from(document.querySelectorAll(".scope-toggle[data-scope]"));
    if (!videoEl || !stage || !preview || !toggles.length) return;

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
            y: "Channel level (0 → 255)",
            channels: [
                { name: "R", color: "#ff5a5a" },
                { name: "G", color: "#5dff7a" },
                { name: "B", color: "#5aa7ff" },
            ],
        },
        histogram: {
            title: "Histogram",
            x: "Level 0 → 255",
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
        legal: {
            title: "Legal range",
            x: "Frame X",
            y: "Frame Y",
            note: "Yellow — outside broadcast/legal luma range",
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
    let requestToken = 0;
    let playTimer = null;
    let lastRequestKey = "";
    let boundMedia = null;

    function media() {
        return (typeof window.vidplotGetMedia === "function" && window.vidplotGetMedia()) || videoEl;
    }

    function setStatus(message, isError) {
        if (!statusEl) return;
        if (!message) {
            statusEl.hidden = true;
            statusEl.textContent = "";
            statusEl.classList.remove("is-error");
            return;
        }
        statusEl.hidden = false;
        statusEl.textContent = message;
        statusEl.classList.toggle("is-error", !!isError);
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
        const showPip = pictureReady && names.some((name) => SCOPE_PIP.has(name));
        stage.classList.toggle("has-scope-pip", showPip);
    }

    function updateLegend(filters) {
        if (!legendEl) return;
        const names = (filters || []).filter((name) => SCOPE_LEGENDS[name]);
        updateScopePip(filters || names);
        if (!names.length) {
            legendEl.hidden = true;
            legendEl.innerHTML = "";
            return;
        }
        legendEl.innerHTML = names.map((name) => {
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
        legendEl.hidden = false;
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

    function clearPreview() {
        requestToken += 1;
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
        revokePreviewUrl();
        preview.removeAttribute("src");
        preview.hidden = true;
        stage.classList.remove("has-scopes");
        stage.classList.remove("has-scope-pip");
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

    async function refreshScopes(force) {
        const filters = selectedFilters();
        if (!filters.length) {
            clearPreview();
            return;
        }
        updateLegend(filters);
        const path = sourcePath();
        if (!path) {
            setStatus("No source path for scopes", true);
            return;
        }
        const m = media();
        const time = Number(m?.currentTime) || 0;
        const key = `${path}|${filters.join(",")}|${time.toFixed(2)}`;
        if (!force && key === lastRequestKey) return;
        lastRequestKey = key;

        if (abortController) abortController.abort();
        abortController = new AbortController();
        const token = ++requestToken;
        setStatus("Rendering scopes…");

        try {
            const res = await fetch("/api/scopes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path, time, filters }),
                signal: abortController.signal,
            });
            if (token !== requestToken) return;
            if (!res.ok) {
                let details = "Scope preview failed";
                try {
                    const err = await res.json();
                    details = err.details || err.error || details;
                } catch (_) { /* ignore */ }
                throw new Error(details);
            }
            const blob = await res.blob();
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

    document.querySelectorAll(".scope-switch-name").forEach((label) => {
        label.addEventListener("click", (e) => {
            e.stopPropagation();
            const btn = label.parentElement?.querySelector(".scope-toggle");
            if (btn) btn.click();
        });
    });

    // Default bind to native video; rebind when adapter activates
    bindMediaListeners();

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
    window.vidplotRefreshScopes = function () {
        if (active.size) refreshScopes(true);
    };

    videoEl.addEventListener("loadeddata", () => {
        if (active.size) updateScopePip(selectedFilters());
    });

    syncToggleUi();
});
