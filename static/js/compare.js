/**
 * Side-by-side wipe compare: dual preview, synced transport, zoom/pan, fullscreen.
 */
(function () {
    const WIPE_KEY = "vidplotCompareWipe";
    const ORIENT_KEY = "vidplotCompareOrient";

    function defaultState() {
        return {
            enabled: false,
            orientation: "vertical",
            wipe: 0.5,
            activeSlot: "A",
            zoom: 1,
            panX: 0,
            panY: 0,
            fullscreen: false,
            slots: {
                A: null,
                B: null,
            },
        };
    }

    window.vidplotCompare = defaultState();

    function el(id) {
        return document.getElementById(id);
    }

    function slotEls(slot) {
        const suffix = slot === "B" ? "B" : "A";
        return {
            video: el(`videoPlayer${suffix}`),
            canvas: el(`previewCanvas${suffix}`),
            source: el(`videoSource${suffix}`),
            scopeImg: el(`scopePreview${suffix}`),
            label: el(`compareLabel${suffix}`),
            layer: document.querySelector(`.compare-layer[data-slot="${slot}"]`),
        };
    }

    function loadWipe() {
        try {
            const v = parseFloat(localStorage.getItem(WIPE_KEY));
            if (Number.isFinite(v)) return Math.max(0.02, Math.min(0.98, v));
        } catch (_) { /* ignore */ }
        return 0.5;
    }

    function loadOrient() {
        try {
            const o = localStorage.getItem(ORIENT_KEY);
            if (o === "horizontal" || o === "vertical") return o;
        } catch (_) { /* ignore */ }
        return "vertical";
    }

    function persistUi() {
        try {
            localStorage.setItem(WIPE_KEY, String(window.vidplotCompare.wipe));
            localStorage.setItem(ORIENT_KEY, window.vidplotCompare.orientation);
        } catch (_) { /* ignore */ }
    }

    function isEnabled() {
        return window.vidplotCompare.enabled;
    }

    function getSlotData(slot) {
        return window.vidplotCompare.slots[slot] || null;
    }

    function setActiveSlot(slot) {
        if (!isEnabled()) return;
        const s = slot === "B" ? "B" : "A";
        window.vidplotCompare.activeSlot = s;
        document.querySelectorAll(".compare-layer").forEach((layer) => {
            layer.classList.toggle("is-active-slot", layer.dataset.slot === s);
        });
        const data = getSlotData(s);
        if (data?.jsonData && typeof updatemediaInfo === "function") {
            updatemediaInfo(data.jsonData, { slot: s });
        }
        if (data?.jsonData?.frames?.length && typeof setupPlotlyChart === "function") {
            try {
                setupPlotlyChart(data.jsonData);
            } catch (err) {
                console.error(err);
            }
        }
    }

    function applyWipeCss() {
        const cmp = window.vidplotCompare;
        const pane = el("comparePane");
        const divider = el("compareDivider");
        if (!pane || !divider) return;
        const pct = Math.round(cmp.wipe * 100);
        pane.dataset.orientation = cmp.orientation;
        pane.style.setProperty("--compare-wipe", `${pct}%`);
        if (cmp.orientation === "horizontal") {
            divider.style.left = "0";
            divider.style.right = "0";
            divider.style.top = `${pct}%`;
            divider.style.width = "100%";
            divider.style.height = "2px";
            divider.style.transform = "translateY(-50%)";
            divider.style.cursor = "row-resize";
            divider.setAttribute("aria-orientation", "horizontal");
        } else {
            divider.style.top = "0";
            divider.style.bottom = "0";
            divider.style.left = `${pct}%`;
            divider.style.width = "2px";
            divider.style.height = "auto";
            divider.style.transform = "translateX(-50%)";
            divider.style.cursor = "col-resize";
            divider.setAttribute("aria-orientation", "vertical");
        }
        const layerB = document.querySelector(".compare-layer-b");
        if (layerB) {
            if (cmp.orientation === "horizontal") {
                layerB.style.clipPath = `inset(${pct}% 0 0 0)`;
            } else {
                layerB.style.clipPath = `inset(0 0 0 ${pct}%)`;
            }
        }
    }

    function applyTransform() {
        const pane = el("comparePane");
        if (!pane) return;
        const { zoom, panX, panY } = window.vidplotCompare;
        pane.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    }

    function syncLabels() {
        const a = getSlotData("A");
        const b = getSlotData("B");
        const labelA = el("compareLabelA");
        const labelB = el("compareLabelB");
        if (labelA) labelA.textContent = a?.filename || a?.path || "Video A";
        if (labelB) labelB.textContent = b?.filename || b?.path || "Video B";
    }

    function showCompareUi() {
        const single = el("singleStage");
        const compare = el("compareStage");
        document.body.classList.add("compare-mode");
        if (single) {
            single.hidden = true;
            single.style.display = "none";
        }
        if (compare) {
            compare.hidden = false;
            compare.style.display = "flex";
        }
        applyWipeCss();
        applyTransform();
        syncLabels();
        setActiveSlot(window.vidplotCompare.activeSlot || "A");
        requestAnimationFrame(() => {
            applyWipeCss();
            if (typeof window.vidplotResizeFrameChart === "function") {
                window.vidplotResizeFrameChart();
            }
        });
    }

    function showSingleUi() {
        const single = el("singleStage");
        const compare = el("compareStage");
        document.body.classList.remove("compare-mode");
        if (single) {
            single.hidden = false;
            single.style.display = "flex";
        }
        if (compare) {
            compare.hidden = true;
            compare.style.display = "none";
        }
    }

    function bindCompareSyncTransport() {
        if (typeof window.vidplotBindCompareTransport === "function") {
            window.vidplotBindCompareTransport();
        }
        if (typeof window.vidplotBindPlayerMedia === "function") {
            window.vidplotBindPlayerMedia();
        }
    }

    function enterCompareMode(opts = {}) {
        const cmp = window.vidplotCompare;
        cmp.enabled = true;
        cmp.orientation = opts.orientation || loadOrient();
        cmp.wipe = opts.wipe != null ? opts.wipe : loadWipe();
        cmp.zoom = 1;
        cmp.panX = 0;
        cmp.panY = 0;
        cmp.activeSlot = "A";
        if (!cmp.slots.A && window.vidplotCurrentSourcePath) {
            cmp.slots.A = {
                path: window.vidplotCurrentSourcePath,
                filename: window.vidplotCurrentFilename || "",
                jsonData: window.vidplotJsonData,
                previewMode: window.vidplotPreviewMode || "native",
                videoUrl: window.vidplotCurrentVideoUrl || "",
                generation: 0,
            };
        }
        showCompareUi();
        bindCompareSyncTransport();
        if (typeof window.vidplotOnCompareModeChange === "function") {
            window.vidplotOnCompareModeChange(true);
        }
    }

    function exitCompareMode() {
        const cmp = window.vidplotCompare;
        cmp.enabled = false;
        cmp.slots.B = null;
        cmp.fullscreen = false;
        showSingleUi();
        if (typeof window.vidplotDestroySlotPreview === "function") {
            window.vidplotDestroySlotPreview("B");
        }
        if (typeof window.vidplotRestoreSinglePreview === "function") {
            window.vidplotRestoreSinglePreview();
        }
        bindCompareSyncTransport();
        if (typeof window.vidplotOnCompareModeChange === "function") {
            window.vidplotOnCompareModeChange(false);
        }
        const a = cmp.slots.A;
        if (a?.jsonData) {
            window.vidplotCurrentSourcePath = a.path;
            window.vidplotCurrentFilename = a.filename;
            window.vidplotJsonData = a.jsonData;
            if (typeof updatemediaInfo === "function") {
                updatemediaInfo(a.jsonData);
            }
            if (a.jsonData.frames?.length && typeof setupPlotlyChart === "function") {
                try {
                    setupPlotlyChart(a.jsonData);
                } catch (err) {
                    console.error(err);
                }
            }
        }
    }

    function assignSlot(slot, data) {
        const s = slot === "B" ? "B" : "A";
        window.vidplotCompare.slots[s] = data;
        syncLabels();
    }

    function slotFromPointer(clientX, clientY) {
        const viewport = el("compareViewport");
        if (!viewport) return "A";
        const rect = viewport.getBoundingClientRect();
        const cmp = window.vidplotCompare;
        if (cmp.orientation === "horizontal") {
            const y = (clientY - rect.top) / rect.height;
            return y < cmp.wipe ? "A" : "B";
        }
        const x = (clientX - rect.left) / rect.width;
        return x < cmp.wipe ? "A" : "B";
    }

    function bindDivider() {
        const divider = el("compareDivider");
        const viewport = el("compareViewport");
        if (!divider || !viewport) return;

        let dragging = false;

        const onMove = (e) => {
            if (!dragging) return;
            const rect = viewport.getBoundingClientRect();
            const cmp = window.vidplotCompare;
            if (cmp.orientation === "horizontal") {
                cmp.wipe = Math.max(0.02, Math.min(0.98, (e.clientY - rect.top) / rect.height));
            } else {
                cmp.wipe = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
            }
            applyWipeCss();
            persistUi();
        };

        const onUp = (e) => {
            if (!dragging) return;
            dragging = false;
            document.body.classList.remove("is-resizing-compare");
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            try {
                divider.releasePointerCapture(e.pointerId);
            } catch (_) { /* ignore */ }
        };

        divider.addEventListener("pointerdown", (e) => {
            if (!isEnabled()) return;
            e.preventDefault();
            e.stopPropagation();
            dragging = true;
            document.body.classList.add("is-resizing-compare");
            divider.setPointerCapture(e.pointerId);
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        });

        divider.addEventListener("keydown", (e) => {
            if (!isEnabled()) return;
            const step = e.shiftKey ? 0.05 : 0.02;
            const cmp = window.vidplotCompare;
            if (cmp.orientation === "horizontal") {
                if (e.key === "ArrowUp") cmp.wipe = Math.max(0.02, cmp.wipe - step);
                else if (e.key === "ArrowDown") cmp.wipe = Math.min(0.98, cmp.wipe + step);
                else return;
            } else {
                if (e.key === "ArrowLeft") cmp.wipe = Math.max(0.02, cmp.wipe - step);
                else if (e.key === "ArrowRight") cmp.wipe = Math.min(0.98, cmp.wipe + step);
                else return;
            }
            e.preventDefault();
            applyWipeCss();
            persistUi();
        });
    }

    function bindZoomPan() {
        const viewport = el("compareViewport");
        if (!viewport) return;

        let panning = false;
        let panStartX = 0;
        let panStartY = 0;
        let panOriginX = 0;
        let panOriginY = 0;

        viewport.addEventListener("wheel", (e) => {
            if (!isEnabled()) return;
            if (e.target.closest("#compareDivider")) return;
            e.preventDefault();
            const cmp = window.vidplotCompare;
            const delta = e.deltaY > 0 ? -0.08 : 0.08;
            cmp.zoom = Math.max(1, Math.min(6, cmp.zoom + delta * cmp.zoom));
            if (cmp.zoom <= 1) {
                cmp.zoom = 1;
                cmp.panX = 0;
                cmp.panY = 0;
            }
            applyTransform();
        }, { passive: false });

        viewport.addEventListener("pointerdown", (e) => {
            if (!isEnabled()) return;
            if (e.target.closest("#compareDivider")) return;
            if (window.vidplotCompare.zoom <= 1) return;
            if (e.button !== 0) return;
            panning = true;
            panStartX = e.clientX;
            panStartY = e.clientY;
            panOriginX = window.vidplotCompare.panX;
            panOriginY = window.vidplotCompare.panY;
            viewport.setPointerCapture(e.pointerId);
            e.preventDefault();
        });

        viewport.addEventListener("pointermove", (e) => {
            if (!panning) return;
            window.vidplotCompare.panX = panOriginX + (e.clientX - panStartX);
            window.vidplotCompare.panY = panOriginY + (e.clientY - panStartY);
            applyTransform();
        });

        viewport.addEventListener("pointerup", (e) => {
            if (!panning) return;
            panning = false;
            try {
                viewport.releasePointerCapture(e.pointerId);
            } catch (_) { /* ignore */ }
        });
    }

    function bindSlotClicks() {
        const viewport = el("compareViewport");
        if (!viewport) return;

        viewport.addEventListener("click", (e) => {
            if (!isEnabled()) return;
            if (e.target.closest("#compareDivider")) return;
            setActiveSlot(slotFromPointer(e.clientX, e.clientY));
        });

        viewport.addEventListener("dblclick", (e) => {
            if (!isEnabled()) return;
            e.preventDefault();
            const target = el("compareViewport");
            if (!target) return;
            if (!document.fullscreenElement) {
                target.requestFullscreen?.().catch(() => {});
                window.vidplotCompare.fullscreen = true;
            } else {
                document.exitFullscreen?.();
                window.vidplotCompare.fullscreen = false;
            }
        });

        document.addEventListener("fullscreenchange", () => {
            window.vidplotCompare.fullscreen = !!document.fullscreenElement;
        });
    }

    function bindToolbar() {
        const vert = el("compareOrientVertical");
        const horiz = el("compareOrientHorizontal");
        const end = el("compareEndBtn");

        if (vert) {
            vert.addEventListener("click", () => {
                window.vidplotCompare.orientation = "vertical";
                vert.classList.add("is-active");
                if (horiz) horiz.classList.remove("is-active");
                applyWipeCss();
                persistUi();
            });
        }
        if (horiz) {
            horiz.addEventListener("click", () => {
                window.vidplotCompare.orientation = "horizontal";
                horiz.classList.add("is-active");
                if (vert) vert.classList.remove("is-active");
                applyWipeCss();
                persistUi();
            });
        }
        if (end) {
            end.addEventListener("click", () => {
                exitCompareMode();
            });
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        window.vidplotCompare.wipe = loadWipe();
        window.vidplotCompare.orientation = loadOrient();
        bindDivider();
        bindZoomPan();
        bindSlotClicks();
        bindToolbar();
    });

    window.vidplotEnterCompareMode = enterCompareMode;
    window.vidplotExitCompareMode = exitCompareMode;
    window.vidplotIsCompareMode = isEnabled;
    window.vidplotAssignCompareSlot = assignSlot;
    window.vidplotGetCompareSlot = getSlotData;
    window.vidplotSelectCompareSlot = setActiveSlot;
    window.vidplotGetCompareSlotElements = slotEls;
    window.vidplotApplyCompareWipe = applyWipeCss;
})();
