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
    const dropError = document.getElementById("dropError");

    let desktopMode = document.body?.dataset?.desktop === "1";
    let analyzePulseTimer = null;
    let analysisGeneration = 0;

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
        setLoadDropStatus("Load new video", "file, drop, or URL", { busy: false, error: false });
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

    function resetWorkspaceToDrop({ cancelAnalysis = false } = {}) {
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
        window.vidplotJsonData = null;
        clearDropError();
        resetLoadDropStatus();
        if (cancelAnalysis) analysisGeneration += 1;
        setAnalysisStatus("");
        showFrameChartPlaceholder("");
        showDropZone();
        resetProgress();
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

    function isDesktopApp() {
        return desktopMode || !!(window.pywebview && window.pywebview.api);
    }

    function updateDropCopy() {
        const hint = dropArea.querySelector(".drop-hint");
        if (isDesktopApp() && hint) {
            hint.textContent = "Local path or HTTP(S) URL — no copy created";
        }
    }

    function fileSystemPath(file) {
        if (!file) return "";
        return file.path || file.pywebviewFullPath || "";
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

    function showFrameChartPlaceholder(message) {
        const chart = document.getElementById("frameChart");
        if (!chart) return;
        chart.innerHTML = `<div class="chart-placeholder">${message || "Analyzing frames…"}</div>`;
    }

    function requestQpAnalysis(path, generation) {
        if (!path) return;
        setAnalysisStatus("Computing Avg QP…");
        fetch("/api/analyze-qp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path }),
        })
            .then(async (res) => {
                const data = await res.json();
                if (generation !== analysisGeneration) return;
                if (!res.ok) {
                    throw new Error(data.details || data.error || "QP analysis failed");
                }
                if (typeof vidplotUpdateMeanQp === "function") {
                    vidplotUpdateMeanQp(data.mean_qps || []);
                }
                setAnalysisStatus(data.qp_available ? "" : "Avg QP unavailable");
                if (!data.qp_available) {
                    setTimeout(() => {
                        if (generation === analysisGeneration) setAnalysisStatus("");
                    }, 4000);
                }
            })
            .catch((err) => {
                if (generation !== analysisGeneration) return;
                console.error(err);
                setAnalysisStatus("Avg QP failed");
                setTimeout(() => {
                    if (generation === analysisGeneration) setAnalysisStatus("");
                }, 4000);
            });
    }

    function requestFramesAnalysis(path, jsonData, generation) {
        setAnalysisStatus("Analyzing frames…");
        showFrameChartPlaceholder("Analyzing frames…");
        return fetch("/api/analyze-frames", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path }),
        })
            .then(async (res) => {
                const data = await res.json();
                if (generation !== analysisGeneration) return;
                if (!res.ok) {
                    throw new Error(data.details || data.error || "Frame analysis failed");
                }
                jsonData.frames = data.frames || [];
                jsonData.frames_pending = false;
                jsonData.qp_pending = !!data.qp_pending;
                window.vidplotJsonData = jsonData;

                try {
                    if (typeof updatemediaInfo === "function") {
                        updatemediaInfo(jsonData);
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
                    requestQpAnalysis(path, generation);
                } else {
                    setAnalysisStatus("");
                }
            })
            .catch((err) => {
                if (generation !== analysisGeneration) return;
                console.error(err);
                setAnalysisStatus("Frame analysis failed");
                showFrameChartPlaceholder(err.message || "Frame analysis failed");
            });
    }

    function presentShell(result, jsonData, generation) {
        clearDropError();
        resetLoadDropStatus();
        window.vidplotCurrentFilename = result.filename || jsonData?.format?.filename || "";
        window.vidplotJsonData = jsonData;
        if (videoSource) videoSource.src = result.video_url;
        if (videoPlayer) {
            videoPlayer.style.display = "block";
            videoPlayer.load();
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

        const path = result.source_path || jsonData?.format?.source_path || "";
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

    async function analyzeLocalPath(path) {
        if (!path) return;
        const generation = ++analysisGeneration;
        clearDropError();
        if (videoPlayer) videoPlayer.pause();
        setLoadDropStatus("Opening…", "Please wait", { busy: true });
        const urlBtn = document.getElementById("urlOpenBtn");
        if (urlBtn) urlBtn.disabled = true;
        startAnalyzePulse();
        try {
            const res = await fetch("/api/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path }),
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

    window.vidplotOpenPath = analyzeLocalPath;

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
        analyzeLocalPath(raw);
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

    async function waitForNativeApi(timeoutMs = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (window.pywebview?.api?.open_video) return window.pywebview.api;
            await new Promise((r) => setTimeout(r, 50));
        }
        return null;
    }

    async function pickNativeVideo() {
        clearDropError();
        setProgress("Opening file picker…", 5);
        try {
            const api = await waitForNativeApi();
            if (!api) {
                throw new Error(
                    "Desktop bridge not ready. Quit and relaunch VidPlot (use python desktop.py or rebuild the app)."
                );
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
        const uriList = (
            event.dataTransfer.getData("text/uri-list")
            || event.dataTransfer.getData("text/plain")
            || ""
        ).trim().split(/\r?\n/).find((line) => line && !line.startsWith("#"));
        if (uriList && isHttpUrl(uriList)) {
            const input = document.getElementById("urlOpenInput");
            if (input) input.value = uriList.trim();
            analyzeLocalPath(uriList.trim());
            return;
        }
        const file = event.dataTransfer.files[0];
        if (!file) return;
        const path = fileSystemPath(file);
        if (path) {
            analyzeLocalPath(path);
            return;
        }
        if (isDesktopApp()) {
            // Desktop paths arrive via pywebview's native drop bridge (desktop.py).
            // Do not open the file picker — that was the old fallback and felt broken.
            return;
        }
        handleUploadedFile(file);
    });

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
            const file = event.dataTransfer.files[0];
            if (!file) return;
            const path = fileSystemPath(file);
            if (path) {
                analyzeLocalPath(path);
                return;
            }
            if (isDesktopApp()) {
                // Path is delivered by desktop.py's native drop bridge
                return;
            }
            handleUploadedFile(file);
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
        if (isDesktopApp()) {
            pickNativeVideo();
        } else {
            videoUpload.click();
        }
    });

    videoUpload.addEventListener("change", (event) => {
        // Hard block upload path in desktop mode
        if (isDesktopApp()) {
            videoUpload.value = "";
            pickNativeVideo();
            return;
        }
        const file = event.target.files[0];
        if (file) handleUploadedFile(file);
    });

    updateDropCopy();
    window.addEventListener("pywebviewready", () => {
        desktopMode = true;
        document.body.dataset.desktop = "1";
        updateDropCopy();
    });

    function handleUploadedFile(file) {
        // Browser-only fallback
        if (isDesktopApp()) {
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
