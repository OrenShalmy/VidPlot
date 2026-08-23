document.addEventListener("DOMContentLoaded", function () {
    const dropArea = document.getElementById("dropArea");
    const videoUpload = document.getElementById("videoUpload");
    const videoPlayer = document.getElementById("videoPlayer");
    const videoSource = document.getElementById("videoSource");
    const mediaInfo = document.getElementById("mediaInfo");
    const videoSection = document.getElementById("videoSection");
    const bottomChrome = document.getElementById("bottomChrome");
    const frameGraphSection = document.getElementById("frameGraphSection");
    const sideMenu = document.getElementById("sideMenu");
    const sideMenuToggle = document.getElementById("sideMenuToggle");
    const sideMenuFold = document.getElementById("sideMenuFold");
    const loadNewVideoBtn = document.getElementById("loadNewVideoBtn");
    const compareVideoBtn = document.getElementById("compareVideoBtn");
    const dropError = document.getElementById("dropError");

    let desktopMode = document.body?.dataset?.desktop === "1";
    let analyzePulseTimer = null;
    let analysisGeneration = 0;
    let compareBGeneration = 0;
    let pendingOpenPath = "";
    let rawParamsResolver = null;

    window.vidplotInputByPath = window.vidplotInputByPath || {};

    const RAW_PARAMS_KEY = "vidplotRawParams";
    const RAW_PARAM_EXTS = new Set(["yuv", "raw"]);

    function pathExtension(path) {
        const base = String(path || "").split(/[?#]/)[0];
        const name = base.split(/[/\\]/).pop() || "";
        const dot = name.lastIndexOf(".");
        return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
    }

    function needsRawParams(path) {
        return RAW_PARAM_EXTS.has(pathExtension(path));
    }

    function inputOptsForPath(path) {
        if (!path) return null;
        return window.vidplotInputByPath[path]
            || window.vidplotJsonData?.format?.vidplot_input
            || null;
    }

    function rememberInputOpts(path, opts) {
        if (!path || !opts) return;
        window.vidplotInputByPath[path] = opts;
        try {
            localStorage.setItem(RAW_PARAMS_KEY, JSON.stringify(opts));
        } catch (_) { /* ignore */ }
    }

    function loadSavedRawParams() {
        try {
            const raw = localStorage.getItem(RAW_PARAMS_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") return null;
            return parsed;
        } catch (_) {
            return null;
        }
    }

    function validateRawParamsForm() {
        const pix = (document.getElementById("rawPixFmt")?.value || "").trim().toLowerCase();
        const rate = (document.getElementById("rawFrameRate")?.value || "").trim();
        const size = (document.getElementById("rawSize")?.value || "").trim().toLowerCase().replace(/\s+/g, "");
        const errEl = document.getElementById("rawParamsError");
        const fail = (msg) => {
            if (errEl) {
                errEl.hidden = false;
                errEl.textContent = msg;
            }
            return null;
        };
        if (!pix) return fail("Enter a pixel format (e.g. yuv420p)");
        if (!/^[a-z0-9_]+$/.test(pix)) return fail("Invalid pixel format name");
        if (!rate || !Number.isFinite(Number(rate)) || Number(rate) <= 0) {
            return fail("Enter a valid frame rate (e.g. 25)");
        }
        if (!/^\d+x\d+$/.test(size)) return fail("Size must look like 1920x1080");
        if (errEl) {
            errEl.hidden = true;
            errEl.textContent = "";
        }
        const rateNum = Number(rate);
        return {
            format: "rawvideo",
            pixel_format: pix,
            size,
            framerate: rateNum === Math.floor(rateNum) ? String(Math.floor(rateNum)) : String(rateNum),
        };
    }

    function hideRawParamsDialog(result) {
        const dialog = document.getElementById("rawParamsDialog");
        if (dialog) dialog.hidden = true;
        const resolve = rawParamsResolver;
        rawParamsResolver = null;
        if (resolve) resolve(result);
    }

    function promptRawParams(path) {
        const dialog = document.getElementById("rawParamsDialog");
        const form = document.getElementById("rawParamsForm");
        if (!dialog || !form) return Promise.resolve(null);

        const hint = document.getElementById("rawParamsFileHint");
        if (hint) {
            const name = String(path || "").split(/[/\\]/).pop() || "file";
            hint.textContent = `${name} needs pixel format, size, and frame rate.`;
        }

        const saved = loadSavedRawParams() || {};
        const pixEl = document.getElementById("rawPixFmt");
        const rateEl = document.getElementById("rawFrameRate");
        const sizeEl = document.getElementById("rawSize");
        if (pixEl) pixEl.value = saved.pixel_format || "yuv420p";
        if (rateEl) rateEl.value = saved.framerate || "25";
        if (sizeEl) sizeEl.value = saved.size || "1920x1080";
        const errEl = document.getElementById("rawParamsError");
        if (errEl) {
            errEl.hidden = true;
            errEl.textContent = "";
        }

        dialog.hidden = false;
        setTimeout(() => pixEl?.focus(), 0);

        return new Promise((resolve) => {
            rawParamsResolver = resolve;
        });
    }

    async function ensureRawInput(path) {
        if (!needsRawParams(path)) return undefined;
        const opts = await promptRawParams(path);
        if (!opts) return null;
        rememberInputOpts(path, opts);
        return opts;
    }

    if (videoSection) videoSection.style.display = "none";
    if (bottomChrome) bottomChrome.style.display = "none";
    else if (frameGraphSection) frameGraphSection.style.display = "none";

    function showSideMenu() {
        if (!sideMenu) return;
        sideMenu.classList.add("visible");
        sideMenu.classList.add("collapsed");
        sideMenu.setAttribute("aria-hidden", "false");
        if (sideMenuToggle) {
            sideMenuToggle.hidden = false;
            sideMenuToggle.setAttribute("aria-expanded", "false");
            sideMenuToggle.title = "Show options";
        }
        if (sideMenuFold) sideMenuFold.setAttribute("aria-expanded", "false");
    }

    showSideMenu();

    function setSideMenuCollapsed(collapsed) {
        if (!sideMenu) return;
        sideMenu.classList.toggle("collapsed", collapsed);
        if (sideMenuToggle) {
            sideMenuToggle.hidden = !collapsed;
            sideMenuToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
            sideMenuToggle.title = collapsed ? "Show options" : "Hide options";
        }
        if (sideMenuFold) {
            sideMenuFold.setAttribute("aria-expanded", collapsed ? "false" : "true");
        }
        // Config text fields keep focus when the drawer closes, which blocks JKL / frame keys
        if (collapsed) {
            const active = document.activeElement;
            if (active && sideMenu.contains(active) && typeof active.blur === "function") {
                active.blur();
            }
        }
    }

    function showWorkspace() {
        document.body.classList.add("is-loaded");
        if (compareVideoBtn) {
            compareVideoBtn.hidden = false;
            compareVideoBtn.disabled = false;
        }
        // Clear any inline display from showDropZone — CSS alone cannot override it
        if (dropArea) dropArea.style.display = "";
        if (videoSection) videoSection.style.display = "flex";
        if (bottomChrome) bottomChrome.style.display = "flex";
        else if (frameGraphSection) frameGraphSection.style.display = "flex";
        if (typeof window.vidplotResetPanelsForNewVideo === "function") {
            window.vidplotResetPanelsForNewVideo();
        } else if (typeof window.vidplotExpandPanels === "function") {
            window.vidplotExpandPanels();
        }
        showSideMenu();
    }

    function showDropZone() {
        document.body.classList.remove("is-loaded");
        if (compareVideoBtn) {
            compareVideoBtn.hidden = true;
            compareVideoBtn.disabled = true;
        }
        document.body.classList.remove("panel-side-collapsed", "panel-graph-collapsed");
        if (videoSection) videoSection.style.display = "none";
        if (bottomChrome) bottomChrome.style.display = "none";
        else if (frameGraphSection) frameGraphSection.style.display = "none";
        if (dropArea) dropArea.style.display = "flex";
        showSideMenu();
    }

    function showDropError(message) {
        if (!dropError) {
            alert(message);
            return;
        }
        dropError.textContent = message;
        dropError.hidden = false;
    }

    function clearDropError() {
        if (!dropError) return;
        dropError.textContent = "";
        dropError.hidden = true;
    }

    if (sideMenuToggle) {
        sideMenuToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            setSideMenuCollapsed(false);
        });
    }
    if (sideMenuFold) {
        sideMenuFold.addEventListener("click", (e) => {
            e.stopPropagation();
            setSideMenuCollapsed(true);
        });
    }

    document.addEventListener("click", (e) => {
        if (!sideMenu || !sideMenu.classList.contains("visible")) return;
        if (sideMenu.classList.contains("collapsed")) return;
        const panel = document.getElementById("sideMenuPanel");
        const onMenu = sideMenu.contains(e.target)
            || (sideMenuToggle && sideMenuToggle.contains(e.target))
            || (panel && panel.contains(e.target));
        if (!onMenu) setSideMenuCollapsed(true);
    });

    function setLoadDropStatus(title, hint, { busy = false, error = false } = {}) {
        if (!loadNewVideoBtn) return;
        const titleEl = loadNewVideoBtn.querySelector(".load-drop-title");
        const hintEl = loadNewVideoBtn.querySelector(".load-drop-hint");
        if (titleEl) titleEl.textContent = title;
        if (hintEl) {
            hintEl.textContent = hint;
            hintEl.classList.toggle("is-error", !!error);
        }
        loadNewVideoBtn.classList.toggle("is-busy", !!busy);
        loadNewVideoBtn.disabled = !!busy;
    }

    function resetLoadDropStatus() {
        setLoadDropStatus("Load new video", "file, drop anywhere, or URL", { busy: false, error: false });
    }

    function isHttpUrl(value) {
        if (!value || typeof value !== "string") return false;
        try {
            const u = new URL(value.trim());
            return u.protocol === "http:" || u.protocol === "https:";
        } catch (_) {
            return false;
        }
    }

    if (loadNewVideoBtn) {
        loadNewVideoBtn.addEventListener("click", () => {
            if (loadNewVideoBtn.disabled) return;
            resetWorkspaceToDrop({ cancelAnalysis: true });
        });
    }

    async function pickCompareVideo() {
        if (!document.body.classList.contains("is-loaded")) {
            showDropError("Open a video first, then compare.");
            return;
        }
        clearDropError();
        try {
            const api = await waitForNativeApi();
            if (api) {
                const path = await api.open_video();
                if (path) await startCompareWithPath(path);
                return;
            }
            showDropError("Compare needs a local file path (desktop) or drop a second file on the window.");
        } catch (err) {
            console.error(err);
            showDropError(err.message || "Could not open compare file");
        }
    }

    if (compareVideoBtn) {
        compareVideoBtn.addEventListener("click", () => {
            if (compareVideoBtn.disabled) return;
            pickCompareVideo();
        });
    }

    function resetWorkspaceToDrop({ cancelAnalysis = false } = {}) {
        if (typeof window.vidplotExitCompareMode === "function" && window.vidplotIsCompareMode?.()) {
            window.vidplotExitCompareMode();
        }
        if (videoPlayer) {
            videoPlayer.pause();
            videoPlayer.removeAttribute("src");
            if (videoSource) videoSource.src = "";
            videoPlayer.load();
        }
        if (mediaInfo) mediaInfo.innerHTML = "";
        const streamTree = document.getElementById("streamTree");
        if (streamTree) streamTree.innerHTML = "";
        if (videoUpload) videoUpload.value = "";
        window.vidplotCurrentFilename = "";
        window.vidplotCurrentSourcePath = "";
        window.vidplotCurrentVideoUrl = "";
        window.vidplotJsonData = null;
        clearDropError();
        resetLoadDropStatus();
        if (cancelAnalysis) analysisGeneration += 1;
        setAnalysisStatus("");
        showFrameChartPlaceholder("");
        showDropZone();
        resetProgress();
        if (videoPlayer) videoPlayer.dataset.vidplotSource = "";
        if (typeof window.vidplotResetScopes === "function") {
            window.vidplotResetScopes();
        }
    }

    // Append progress without innerHTML += (that would destroy #dropError)
    let progressContainer = document.getElementById("uploadProgress");
    if (!progressContainer) {
        progressContainer = document.createElement("div");
        progressContainer.id = "uploadProgress";
        const bar = document.createElement("div");
        bar.className = "progress-bar";
        progressContainer.appendChild(bar);
        dropArea.appendChild(progressContainer);
    }
    const progressBar = progressContainer.querySelector(".progress-bar");

    function stopAnalyzePulse() {
        if (analyzePulseTimer) {
            clearInterval(analyzePulseTimer);
            analyzePulseTimer = null;
        }
    }

    function resetProgress() {
        stopAnalyzePulse();
        if (progressContainer) progressContainer.style.display = "none";
        if (progressBar) progressBar.style.width = "0%";
        const progressLabel = document.getElementById("progressLabel");
        if (progressLabel) progressLabel.remove();
    }

    function setProgress(labelText, percent) {
        progressContainer.style.display = "block";
        if (typeof percent === "number") {
            progressBar.style.width = Math.max(0, Math.min(100, percent)) + "%";
        }
        let progressLabel = document.getElementById("progressLabel");
        if (!progressLabel) {
            progressLabel = document.createElement("div");
            progressLabel.id = "progressLabel";
            progressContainer.appendChild(progressLabel);
        }
        progressLabel.textContent = labelText;
    }

    function startAnalyzePulse() {
        stopAnalyzePulse();
        let pct = 20;
        setProgress("Analyzing frames…", pct);
        analyzePulseTimer = setInterval(() => {
            // Indeterminate-style fill while ffprobe runs (can take a while)
            pct = pct >= 90 ? 35 : pct + 2;
            setProgress("Analyzing frames…", pct);
        }, 400);
    }

    function hasNativeDesktopBridge() {
        return !!window.vidplotDesktop?.openVideo;
    }

    function isDesktopApp() {
        return desktopMode || !!window.vidplotDesktop;
    }

    function updateDropCopy() {
        const hint = dropArea.querySelector(".drop-hint");
        if (isDesktopApp() && hint) {
            hint.textContent = "Local path or HTTP(S) URL — no copy created";
        }
    }

    function fileSystemPath(file) {
        if (!file) return "";
        if (window.vidplotDesktop && typeof window.vidplotDesktop.pathForFile === "function") {
            try {
                const electronPath = window.vidplotDesktop.pathForFile(file);
                if (electronPath) return electronPath;
            } catch (_) { /* ignore */ }
        }
        return file.path || "";
    }

    fetch("/api/env")
        .then((r) => r.json())
        .then((env) => {
            if (env.desktop) {
                desktopMode = true;
                document.body.dataset.desktop = "1";
                updateDropCopy();
            }
        })
        .catch(() => {});

    function setAnalysisStatus(message) {
        const el = document.getElementById("analysisStatus");
        if (!el) return;
        el.textContent = message || "";
    }

    function showLoadChoiceDialog() {
        const dialog = document.getElementById("loadChoiceDialog");
        if (!dialog) {
            if (pendingOpenPath) analyzeLocalPath(pendingOpenPath);
            return;
        }
        dialog.hidden = false;
    }

    function hideLoadChoiceDialog() {
        const dialog = document.getElementById("loadChoiceDialog");
        if (dialog) dialog.hidden = true;
        pendingOpenPath = "";
    }

    function queueOpenPath(path) {
        if (!path) return;
        if (document.body.classList.contains("is-loaded") && window.vidplotCurrentSourcePath) {
            pendingOpenPath = path;
            showLoadChoiceDialog();
            return;
        }
        openPathWithRawGate(path, "replace");
    }

    async function openPathWithRawGate(path, mode) {
        if (!path) return;
        const input = await ensureRawInput(path);
        if (needsRawParams(path) && input == null) return;
        if (mode === "compare") {
            await startCompareWithPath(path, input || undefined);
        } else {
            await analyzeLocalPath(path, input || undefined);
        }
    }

    const loadChoiceReplace = document.getElementById("loadChoiceReplace");
    const loadChoiceCompare = document.getElementById("loadChoiceCompare");
    const loadChoiceDialog = document.getElementById("loadChoiceDialog");

    if (loadChoiceReplace) {
        loadChoiceReplace.addEventListener("click", () => {
            const path = pendingOpenPath;
            hideLoadChoiceDialog();
            if (path) openPathWithRawGate(path, "replace");
        });
    }
    if (loadChoiceCompare) {
        loadChoiceCompare.addEventListener("click", () => {
            const path = pendingOpenPath;
            hideLoadChoiceDialog();
            if (path) openPathWithRawGate(path, "compare");
        });
    }
    if (loadChoiceDialog) {
        loadChoiceDialog.querySelectorAll("[data-load-choice-dismiss]").forEach((btn) => {
            btn.addEventListener("click", () => hideLoadChoiceDialog());
        });
    }

    const rawParamsForm = document.getElementById("rawParamsForm");
    const rawParamsDialog = document.getElementById("rawParamsDialog");
    if (rawParamsForm) {
        rawParamsForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const opts = validateRawParamsForm();
            if (!opts) return;
            hideRawParamsDialog(opts);
        });
    }
    if (rawParamsDialog) {
        rawParamsDialog.querySelectorAll("[data-raw-params-dismiss]").forEach((btn) => {
            btn.addEventListener("click", () => hideRawParamsDialog(null));
        });
    }

    function enableSlotPreview(slot, slotData, initialTime) {
        if (!slotData || typeof window.vidplotEnableSlotPreviewMode !== "function") return;
        const els = typeof window.vidplotGetCompareSlotElements === "function"
            ? window.vidplotGetCompareSlotElements(slot)
            : null;
        window.vidplotEnableSlotPreviewMode(slot, {
            mode: slotData.previewMode || "native",
            path: slotData.path,
            duration: parseFloat(slotData.jsonData?.format?.duration) || 0,
            jsonData: slotData.jsonData,
            videoUrl: slotData.videoUrl,
            initialTime: Number(initialTime) || 0,
            video: els?.video,
            canvas: els?.canvas,
            source: els?.source,
        });
    }

    async function startCompareWithPath(pathB, inputOpts) {
        if (!pathB) return;
        if (inputOpts === undefined && needsRawParams(pathB)) {
            const gated = await ensureRawInput(pathB);
            if (gated == null) return;
            inputOpts = gated;
        }
        if (typeof window.vidplotSnapshotSinglePreview === "function") {
            window.vidplotSnapshotSinglePreview();
        }
        const syncTime = (typeof window.vidplotGetMedia === "function" && window.vidplotGetMedia()?.currentTime) || 0;

        if (!window.vidplotIsCompareMode?.()) {
            if (typeof window.vidplotEnterCompareMode === "function") {
                window.vidplotEnterCompareMode();
            }
            const a = window.vidplotGetCompareSlot?.("A");
            if (a) {
                a.videoUrl = window.vidplotCurrentVideoUrl || a.videoUrl;
                enableSlotPreview("A", a, syncTime);
            }
        }

        const generation = ++compareBGeneration;
        setLoadDropStatus("Opening compare…", "Please wait", { busy: true });
        startAnalyzePulse();
        try {
            const body = { path: pathB };
            if (inputOpts) body.input = inputOpts;
            const res = await fetch("/api/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const result = await res.json();
            if (!res.ok) {
                throw new Error(result.details || result.error || "Analysis failed");
            }
            if (generation !== compareBGeneration) return;
            stopAnalyzePulse();
            let jsonData = result.data;
            if (!jsonData) {
                const jsonRes = await fetch(result.json_url);
                jsonData = await jsonRes.json();
            }
            if (inputOpts) {
                rememberInputOpts(pathB, inputOpts);
                if (jsonData?.format) jsonData.format.vidplot_input = inputOpts;
            } else if (jsonData?.format?.vidplot_input) {
                rememberInputOpts(pathB, jsonData.format.vidplot_input);
            }
            presentCompareSlot("B", result, jsonData, generation, syncTime);
        } catch (err) {
            if (generation !== compareBGeneration) return;
            console.error(err);
            showDropError(err.message || "Compare failed");
        } finally {
            stopAnalyzePulse();
            resetLoadDropStatus();
        }
    }

    function presentCompareSlot(slot, result, jsonData, generation, syncTime) {
        const sourcePath = result.source_path || jsonData?.format?.source_path || "";
        const slotData = {
            path: sourcePath,
            filename: result.filename || jsonData?.format?.filename || "",
            jsonData,
            previewMode: result.preview_hint === "ffmpeg" ? "ffmpeg" : "native",
            generation,
            videoUrl: result.video_url,
        };
        if (typeof window.vidplotAssignCompareSlot === "function") {
            window.vidplotAssignCompareSlot(slot, slotData);
        }
        enableSlotPreview(slot, slotData, syncTime);
        if (typeof window.vidplotBindCompareTransport === "function") {
            window.vidplotBindCompareTransport();
        }
        if (typeof window.vidplotApplyCompareWipe === "function") {
            window.vidplotApplyCompareWipe();
        }
        if (typeof window.vidplotBindPlayerMedia === "function") {
            window.vidplotBindPlayerMedia();
        }
        if (typeof window.vidplotOnSourceReady === "function") {
            window.vidplotOnSourceReady(sourcePath);
        }
        if (typeof window.vidplotSelectCompareSlot === "function") {
            window.vidplotSelectCompareSlot(slot);
        }

        if (result.frames_pending || jsonData?.frames_pending || !(jsonData?.frames || []).length) {
            requestFramesAnalysis(sourcePath, jsonData, generation, { slot, compareGen: true });
        } else if (result.qp_pending || jsonData?.qp_pending) {
            requestQpAnalysis(sourcePath, generation, { slot, compareGen: true });
        }
    }

    function showFrameChartPlaceholder(message) {
        const chart = document.getElementById("frameChart");
        if (!chart) return;
        chart.innerHTML = `<div class="chart-placeholder">${message || "Analyzing frames…"}</div>`;
    }

    function requestQpAnalysis(path, generation, opts = {}) {
        if (!path) return;
        const compareGen = opts.compareGen;
        setAnalysisStatus("Computing Avg QP…");
        fetch("/api/analyze-qp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                path,
                ...(inputOptsForPath(path) ? { input: inputOptsForPath(path) } : {}),
            }),
        })
            .then(async (res) => {
                const data = await res.json();
                if (compareGen && generation !== compareBGeneration) return;
                if (!compareGen && generation !== analysisGeneration) return;
                if (!res.ok) {
                    throw new Error(data.details || data.error || "QP analysis failed");
                }
                if (typeof vidplotUpdateMeanQp === "function") {
                    vidplotUpdateMeanQp(data.mean_qps || []);
                }
                setAnalysisStatus(data.qp_available ? "" : "Avg QP unavailable");
                if (!data.qp_available) {
                    setTimeout(() => {
                        if (compareGen && generation === compareBGeneration) setAnalysisStatus("");
                        if (!compareGen && generation === analysisGeneration) setAnalysisStatus("");
                    }, 4000);
                }
            })
            .catch((err) => {
                if (compareGen && generation !== compareBGeneration) return;
                if (!compareGen && generation !== analysisGeneration) return;
                console.error(err);
                setAnalysisStatus("Avg QP failed");
                setTimeout(() => {
                    if (compareGen && generation === compareBGeneration) setAnalysisStatus("");
                    if (!compareGen && generation === analysisGeneration) setAnalysisStatus("");
                }, 4000);
            });
    }

    function requestFramesAnalysis(path, jsonData, generation, opts = {}) {
        const slot = opts.slot;
        const compareGen = opts.compareGen;
        setAnalysisStatus("Analyzing frames…");
        showFrameChartPlaceholder("Analyzing frames…");
        return fetch("/api/analyze-frames", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                path,
                ...(inputOptsForPath(path) ? { input: inputOptsForPath(path) } : {}),
            }),
        })
            .then(async (res) => {
                const data = await res.json();
                if (compareGen && generation !== compareBGeneration) return;
                if (!compareGen && generation !== analysisGeneration) return;
                if (!res.ok) {
                    throw new Error(data.details || data.error || "Frame analysis failed");
                }
                jsonData.frames = data.frames || [];
                jsonData.frames_pending = false;
                jsonData.qp_pending = !!data.qp_pending;
                if (slot && window.vidplotCompare?.slots?.[slot]) {
                    window.vidplotCompare.slots[slot].jsonData = jsonData;
                }
                window.vidplotJsonData = jsonData;

                try {
                    if (typeof updatemediaInfo === "function") {
                        updatemediaInfo(jsonData, slot ? { slot } : undefined);
                    }
                } catch (err) {
                    console.error("media info refresh failed:", err);
                }

                try {
                    if (typeof setupPlotlyChart === "function" && typeof Plotly !== "undefined") {
                        setupPlotlyChart(jsonData);
                    } else if (typeof Plotly === "undefined") {
                        showFrameChartPlaceholder("Chart library failed to load");
                    }
                } catch (err) {
                    console.error("chart failed:", err);
                    showFrameChartPlaceholder(err.message || "Could not render frame chart");
                }

                if (data.qp_pending) {
                    requestQpAnalysis(path, generation, opts);
                } else {
                    setAnalysisStatus("");
                }
            })
            .catch((err) => {
                if (compareGen && generation !== compareBGeneration) return;
                if (!compareGen && generation !== analysisGeneration) return;
                console.error(err);
                setAnalysisStatus("Frame analysis failed");
                showFrameChartPlaceholder(err.message || "Frame analysis failed");
            });
    }

    function presentShell(result, jsonData, generation) {
        clearDropError();
        resetLoadDropStatus();
        const sourcePath = result.source_path || jsonData?.format?.source_path || "";
        window.vidplotCurrentFilename = result.filename || jsonData?.format?.filename || "";
        window.vidplotCurrentSourcePath = sourcePath;
        window.vidplotCurrentVideoUrl = result.video_url || "";
        window.vidplotJsonData = jsonData;
        if (typeof window.vidplotResetScopes === "function") {
            window.vidplotResetScopes();
        }

        const duration = Number(result.duration)
            || parseFloat(jsonData?.format?.duration)
            || 0;
        const preferFfmpeg = result.preview_hint === "ffmpeg";

        function enablePreview(mode) {
            if (typeof window.vidplotEnablePreviewMode !== "function") return;
            window.vidplotEnablePreviewMode({
                mode,
                path: sourcePath,
                duration,
                jsonData,
                videoUrl: result.video_url,
            });
            if (typeof window.vidplotBindPlayerMedia === "function") {
                window.vidplotBindPlayerMedia();
            }
        }

        function notifySourceReady() {
            if (generation !== analysisGeneration) return;
            if (typeof window.vidplotOnSourceReady === "function") {
                window.vidplotOnSourceReady(sourcePath);
            }
        }

        if (preferFfmpeg) {
            if (videoPlayer) {
                videoPlayer.dataset.vidplotSource = sourcePath;
            }
            enablePreview("ffmpeg");
            notifySourceReady();
        } else {
            if (videoSource && result.video_url) {
                videoSource.src = result.video_url;
            }
            if (videoPlayer) {
                videoPlayer.hidden = false;
                videoPlayer.style.display = "block";
                videoPlayer.dataset.vidplotSource = sourcePath;
                videoPlayer.load();
            }
            enablePreview("native");

            let settled = false;
            const settleNative = () => {
                if (settled || generation !== analysisGeneration) return;
                settled = true;
                notifySourceReady();
            };
            const fallBackToFfmpeg = () => {
                if (settled || generation !== analysisGeneration) return;
                settled = true;
                enablePreview("ffmpeg");
                notifySourceReady();
                // Chart may already be bound to <video> — rebind transport
                if (
                    window.vidplotJsonData?.frames?.length
                    && typeof setupPlotlyChart === "function"
                    && typeof Plotly !== "undefined"
                ) {
                    try {
                        setupPlotlyChart(window.vidplotJsonData);
                    } catch (err) {
                        console.error(err);
                    }
                }
            };
            if (videoPlayer) {
                videoPlayer.addEventListener("canplay", settleNative, { once: true });
                videoPlayer.addEventListener("loadeddata", settleNative, { once: true });
                videoPlayer.addEventListener("error", fallBackToFfmpeg, { once: true });
                setTimeout(() => {
                    if (settled || generation !== analysisGeneration) return;
                    // No usable frame after a short wait — browser likely cannot decode
                    if (!videoPlayer.videoWidth || videoPlayer.error) {
                        fallBackToFfmpeg();
                    } else {
                        settleNative();
                    }
                }, 2500);
            } else {
                fallBackToFfmpeg();
            }
        }

        if (mediaInfo) mediaInfo.style.display = "block";
        showWorkspace();
        try {
            if (typeof updatemediaInfo === "function") {
                updatemediaInfo(jsonData);
            }
        } catch (err) {
            console.error("media info failed:", err);
        }
        showFrameChartPlaceholder("Analyzing frames…");
        resetProgress();

        const path = sourcePath;
        if (result.frames_pending || jsonData?.frames_pending || !(jsonData?.frames || []).length) {
            requestFramesAnalysis(path, jsonData, generation);
        } else if (result.qp_pending || jsonData?.qp_pending) {
            try {
                if (typeof setupPlotlyChart === "function" && typeof Plotly !== "undefined") {
                    setupPlotlyChart(jsonData);
                }
            } catch (err) {
                console.error(err);
            }
            requestQpAnalysis(path, generation);
        } else {
            try {
                if (typeof setupPlotlyChart === "function" && typeof Plotly !== "undefined") {
                    setupPlotlyChart(jsonData);
                }
            } catch (err) {
                console.error(err);
            }
            setAnalysisStatus("");
        }
    }

    async function analyzeLocalPath(path, inputOpts) {
        if (!path) return;
        if (inputOpts === undefined && needsRawParams(path)) {
            const gated = await ensureRawInput(path);
            if (gated == null) return;
            inputOpts = gated;
        }
        if (typeof window.vidplotExitCompareMode === "function" && window.vidplotIsCompareMode?.()) {
            window.vidplotExitCompareMode();
        }
        const generation = ++analysisGeneration;
        clearDropError();
        window.vidplotCurrentSourcePath = path;
        window.vidplotJsonData = null;
        if (typeof window.vidplotResetScopes === "function") {
            window.vidplotResetScopes();
        }
        if (videoPlayer) {
            videoPlayer.pause();
            videoPlayer.removeAttribute("src");
            if (videoSource) videoSource.removeAttribute("src");
            videoPlayer.load();
        }
        if (videoPlayer) videoPlayer.dataset.vidplotSource = "";
        setLoadDropStatus("Opening…", "Please wait", { busy: true });
        const urlBtn = document.getElementById("urlOpenBtn");
        if (urlBtn) urlBtn.disabled = true;
        startAnalyzePulse();
        try {
            const body = { path };
            if (inputOpts) body.input = inputOpts;
            const res = await fetch("/api/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const result = await res.json();
            if (!res.ok) {
                throw new Error(result.details || result.error || "Analysis failed");
            }
            if (generation !== analysisGeneration) return;
            stopAnalyzePulse();
            setProgress("Loading…", 95);
            let jsonData = result.data;
            if (!jsonData) {
                const jsonRes = await fetch(result.json_url);
                jsonData = await jsonRes.json();
            }
            if (inputOpts) {
                rememberInputOpts(path, inputOpts);
                if (jsonData?.format) jsonData.format.vidplot_input = inputOpts;
            } else if (jsonData?.format?.vidplot_input) {
                rememberInputOpts(path, jsonData.format.vidplot_input);
            }
            setProgress("Ready", 100);
            presentShell(result, jsonData, generation);
        } catch (err) {
            if (generation !== analysisGeneration) return;
            console.error(err);
            resetProgress();
            resetLoadDropStatus();
            showDropZone();
            showDropError(err.message || "Analysis failed");
        } finally {
            if (urlBtn) urlBtn.disabled = false;
        }
    }

    window.vidplotOpenPath = queueOpenPath;
    window.vidplotStartCompare = startCompareWithPath;

    // OS "Open with" / cold-start argv → same replace-or-compare flow as drop
    if (window.vidplotDesktop && typeof window.vidplotDesktop.onOpenPath === "function") {
        window.vidplotDesktop.onOpenPath((filePath) => {
            if (filePath) queueOpenPath(filePath);
        });
        if (typeof window.vidplotDesktop.notifyReady === "function") {
            window.vidplotDesktop.notifyReady();
        }
    }

    function openFromUrlInput() {
        const input = document.getElementById("urlOpenInput");
        const raw = (input?.value || "").trim();
        if (!raw) {
            showDropError("Enter an http:// or https:// video URL");
            return;
        }
        if (!isHttpUrl(raw)) {
            showDropError("URL must start with http:// or https://");
            return;
        }
        queueOpenPath(raw);
    }

    const urlOpenForm = document.getElementById("urlOpenForm");
    if (urlOpenForm) {
        urlOpenForm.addEventListener("click", (e) => e.stopPropagation());
        urlOpenForm.addEventListener("submit", (e) => {
            e.preventDefault();
            e.stopPropagation();
            openFromUrlInput();
        });
    }

    async function waitForNativeApi() {
        if (window.vidplotDesktop?.openVideo) {
            return { open_video: () => window.vidplotDesktop.openVideo() };
        }
        return null;
    }

    function pickViaFileInput() {
        resetProgress();
        if (videoUpload) videoUpload.click();
    }

    async function pickNativeVideo() {
        clearDropError();
        setProgress("Opening file picker…", 5);
        try {
            const api = await waitForNativeApi();
            if (!api) {
                pickViaFileInput();
                return;
            }
            const path = await api.open_video();
            if (!path) {
                resetProgress();
                return;
            }
            await analyzeLocalPath(path);
        } catch (err) {
            console.error(err);
            resetProgress();
            showDropError(err.message || "Could not open file picker");
        }
    }

    function handleDroppedTransfer(dataTransfer) {
        if (!dataTransfer) return false;
        const uriList = (
            dataTransfer.getData("text/uri-list")
            || dataTransfer.getData("text/plain")
            || ""
        ).trim().split(/\r?\n/).find((line) => line && !line.startsWith("#"));
        if (uriList && isHttpUrl(uriList)) {
            const input = document.getElementById("urlOpenInput");
            if (input) input.value = uriList.trim();
            queueOpenPath(uriList.trim());
            return true;
        }
        const file = dataTransfer.files && dataTransfer.files[0];
        if (!file) return false;
        const path = fileSystemPath(file);
        if (path) {
            queueOpenPath(path);
            return true;
        }
        if (hasNativeDesktopBridge()) {
            // Electron should resolve a path via pathForFile; otherwise ignore.
            return false;
        }
        handleUploadedFile(file);
        return true;
    }

    function dataTransferHasFiles(dt) {
        if (!dt || !dt.types) return false;
        return Array.from(dt.types).includes("Files")
            || Array.from(dt.types).includes("text/uri-list")
            || Array.from(dt.types).includes("text/plain");
    }

    ["dragenter", "dragover", "dragleave", "drop"].forEach((event) => {
        dropArea.addEventListener(event, (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    ["dragenter", "dragover"].forEach((event) => {
        dropArea.addEventListener(event, () => dropArea.classList.add("highlight"));
    });

    ["dragleave", "drop"].forEach((event) => {
        dropArea.addEventListener(event, () => dropArea.classList.remove("highlight"));
    });

    dropArea.addEventListener("drop", (event) => {
        handleDroppedTransfer(event.dataTransfer);
    });

    // Whole-window drop while a clip is open (and as a global safety net)
    let windowDragDepth = 0;
    function clearWindowDrag() {
        windowDragDepth = 0;
        document.body.classList.remove("vidplot-file-drag");
        if (loadNewVideoBtn) loadNewVideoBtn.classList.remove("drag-over");
    }

    window.addEventListener("dragenter", (e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        windowDragDepth += 1;
        document.body.classList.add("vidplot-file-drag");
    });
    window.addEventListener("dragover", (e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        document.body.classList.add("vidplot-file-drag");
    });
    window.addEventListener("dragleave", (e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        windowDragDepth = Math.max(0, windowDragDepth - 1);
        if (windowDragDepth === 0) {
            document.body.classList.remove("vidplot-file-drag");
        }
    });
    window.addEventListener("drop", (e) => {
        if (!dataTransferHasFiles(e.dataTransfer)) {
            clearWindowDrag();
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        clearWindowDrag();
        // Initial drop zone already handles its own drop; avoid double-open
        if (e.target && e.target.closest && e.target.closest("#dropArea")) return;
        handleDroppedTransfer(e.dataTransfer);
    });
    window.addEventListener("dragend", clearWindowDrag);

    // Side-menu "Load new video" also accepts drops while a clip is open
    if (loadNewVideoBtn) {
        ["dragenter", "dragover", "dragleave", "drop"].forEach((event) => {
            loadNewVideoBtn.addEventListener(event, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });
        ["dragenter", "dragover"].forEach((event) => {
            loadNewVideoBtn.addEventListener(event, () => {
                if (!loadNewVideoBtn.disabled) {
                    loadNewVideoBtn.classList.add("drag-over");
                }
            });
        });
        ["dragleave", "drop"].forEach((event) => {
            loadNewVideoBtn.addEventListener(event, () => {
                loadNewVideoBtn.classList.remove("drag-over");
            });
        });
        loadNewVideoBtn.addEventListener("drop", (event) => {
            if (loadNewVideoBtn.disabled) return;
            handleDroppedTransfer(event.dataTransfer);
        });
    }

    dropArea.addEventListener("click", (e) => {
        if (
            e.target.closest("#uploadProgress")
            || e.target.closest("#dropError")
            || e.target.closest("#urlOpenForm")
        ) {
            return;
        }
        if (hasNativeDesktopBridge()) {
            pickNativeVideo();
        } else {
            videoUpload.click();
        }
    });

    videoUpload.addEventListener("change", (event) => {
        if (hasNativeDesktopBridge()) {
            videoUpload.value = "";
            pickNativeVideo();
            return;
        }
        const file = event.target.files[0];
        if (file) handleUploadedFile(file);
    });

    updateDropCopy();
    if (window.vidplotDesktop) {
        desktopMode = true;
        document.body.dataset.desktop = "1";
        updateDropCopy();
    }

    function handleUploadedFile(file) {
        if (hasNativeDesktopBridge()) {
            pickNativeVideo();
            return;
        }

        clearDropError();
        const formData = new FormData();
        formData.append("video", file);

        setProgress("Uploading…", 5);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/upload", true);

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentCompleted = Math.round((event.loaded * 40) / event.total);
                setProgress(`Uploading: ${percentCompleted}%`, percentCompleted);
            }
        };

        xhr.upload.onload = function () {
            // Upload finished; server is now running ffprobe
            startAnalyzePulse();
        };

        xhr.onload = async function () {
            const generation = ++analysisGeneration;
            try {
                const result = JSON.parse(xhr.responseText);
                if (xhr.status !== 200 || result.error) {
                    throw new Error(result.details || result.error || "Upload failed");
                }
                stopAnalyzePulse();
                setProgress("Loading…", 95);
                let jsonData = result.data;
                if (!jsonData) {
                    const jsonRes = await fetch(result.json_url);
                    jsonData = await jsonRes.json();
                }
                setProgress("Ready", 100);
                presentShell(result, jsonData, generation);
            } catch (err) {
                console.error(err);
                resetProgress();
                showDropError(err.message || "Upload failed");
            }
        };

        xhr.onerror = function () {
            console.error("Upload error:", xhr.statusText);
            resetProgress();
            showDropError("Upload failed");
        };

        xhr.send(formData);
    }
});
