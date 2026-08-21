(function () {
    const PEEK_CHART_HEIGHT = 72;
    const SIDE_WIDTH_KEY = "vidplotSideRailWidth";
    const GRAPH_HEIGHT_KEY = "vidplotGraphHeight";
    const SIDE_MIN = 200;
    const SIDE_MAX = 720;
    const GRAPH_MIN = 140;
    const GRAPH_MAX_RATIO = 0.7;

    function isGraphCollapsed() {
        return document.body.classList.contains("panel-graph-collapsed");
    }

    function isSideCollapsed() {
        return document.body.classList.contains("panel-side-collapsed");
    }

    function syncSideUi() {
        const collapsed = isSideCollapsed();
        const toggle = document.getElementById("sideRailToggle");
        const expand = document.getElementById("sideRailExpand");
        const rail = document.getElementById("sideRail");
        const splitter = document.getElementById("sideRailSplitter");
        if (toggle) {
            toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
            toggle.hidden = collapsed;
            const label = toggle.querySelector(".panel-fold-label");
            if (label) label.textContent = collapsed ? "Expand" : "Fold";
            toggle.title = collapsed ? "Show tracks and properties" : "Fold tracks and properties";
        }
        if (expand) {
            expand.hidden = !collapsed;
            expand.setAttribute("aria-expanded", collapsed ? "false" : "true");
        }
        if (rail) rail.setAttribute("aria-expanded", collapsed ? "false" : "true");
        if (splitter) {
            splitter.hidden = collapsed;
            splitter.setAttribute("aria-hidden", collapsed ? "true" : "false");
        }
    }

    function syncGraphUi() {
        const collapsed = isGraphCollapsed();
        const toggle = document.getElementById("graphPanelToggle");
        const splitter = document.getElementById("graphSplitter");
        if (toggle) {
            toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
            const label = toggle.querySelector(".panel-fold-label");
            if (label) label.textContent = collapsed ? "Expand" : "Fold";
            toggle.title = collapsed ? "Expand frame graph" : "Fold frame graph";
        }
        if (splitter) {
            splitter.hidden = collapsed;
            splitter.setAttribute("aria-hidden", collapsed ? "true" : "false");
        }
    }

    function resizeAfterPanelChange() {
        // Class toggles change flex layout; measure after reflow, then once more
        // in case the video pane height settles a frame later.
        requestAnimationFrame(() => {
            if (typeof window.vidplotResizeFrameChart === "function") {
                window.vidplotResizeFrameChart();
            }
            requestAnimationFrame(() => {
                if (typeof window.vidplotResizeFrameChart === "function") {
                    window.vidplotResizeFrameChart();
                }
                setTimeout(() => {
                    if (typeof window.vidplotResizeFrameChart === "function") {
                        window.vidplotResizeFrameChart();
                    }
                }, 50);
            });
        });
    }

    function applySideWidth(px, { persist = true } = {}) {
        const width = Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, px)));
        document.documentElement.style.setProperty("--vidplot-side-width", `${width}px`);
        if (persist) {
            try {
                localStorage.setItem(SIDE_WIDTH_KEY, String(width));
            } catch (_) { /* ignore */ }
        }
        return width;
    }

    function applyGraphHeight(px, { persist = true } = {}) {
        const mainColumn = document.getElementById("mainColumn");
        const maxByViewport = Math.floor(window.innerHeight * GRAPH_MAX_RATIO);
        const maxByColumn = mainColumn
            ? Math.floor(mainColumn.clientHeight * GRAPH_MAX_RATIO)
            : maxByViewport;
        const maxH = Math.max(GRAPH_MIN, Math.min(maxByViewport, maxByColumn));
        const height = Math.round(Math.max(GRAPH_MIN, Math.min(maxH, px)));
        document.documentElement.style.setProperty("--vidplot-graph-height", `${height}px`);
        if (persist) {
            try {
                localStorage.setItem(GRAPH_HEIGHT_KEY, String(height));
            } catch (_) { /* ignore */ }
        }
        return height;
    }

    function loadSavedSizes() {
        try {
            const side = parseInt(localStorage.getItem(SIDE_WIDTH_KEY), 10);
            if (Number.isFinite(side) && side >= SIDE_MIN) applySideWidth(side, { persist: false });
        } catch (_) { /* ignore */ }
        try {
            const graph = parseInt(localStorage.getItem(GRAPH_HEIGHT_KEY), 10);
            if (Number.isFinite(graph) && graph >= GRAPH_MIN) {
                applyGraphHeight(graph, { persist: false });
            }
        } catch (_) { /* ignore */ }
    }

    function bindVerticalSplitter(splitter) {
        if (!splitter) return;
        let dragging = false;

        const onMove = (e) => {
            if (!dragging) return;
            const rail = document.getElementById("sideRail");
            const workspace = document.getElementById("workspace");
            if (!rail || !workspace) return;
            // Width measured from the right edge of the workspace
            const next = workspace.getBoundingClientRect().right - e.clientX;
            applySideWidth(next, { persist: false });
            resizeAfterPanelChange();
        };

        const onUp = (e) => {
            if (!dragging) return;
            dragging = false;
            document.body.classList.remove("is-resizing-side");
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            const rail = document.getElementById("sideRail");
            if (rail) applySideWidth(rail.getBoundingClientRect().width, { persist: true });
            resizeAfterPanelChange();
            try {
                splitter.releasePointerCapture(e.pointerId);
            } catch (_) { /* ignore */ }
        };

        splitter.addEventListener("pointerdown", (e) => {
            if (isSideCollapsed() || e.button !== 0) return;
            const rail = document.getElementById("sideRail");
            if (!rail) return;
            e.preventDefault();
            dragging = true;
            document.body.classList.add("is-resizing-side");
            splitter.setPointerCapture(e.pointerId);
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
            window.addEventListener("pointercancel", onUp);
        });

        splitter.addEventListener("keydown", (e) => {
            if (isSideCollapsed()) return;
            const rail = document.getElementById("sideRail");
            if (!rail) return;
            const step = e.shiftKey ? 32 : 12;
            if (e.key === "ArrowLeft") {
                e.preventDefault();
                applySideWidth(rail.getBoundingClientRect().width + step);
                resizeAfterPanelChange();
            } else if (e.key === "ArrowRight") {
                e.preventDefault();
                applySideWidth(rail.getBoundingClientRect().width - step);
                resizeAfterPanelChange();
            }
        });
    }

    function bindHorizontalSplitter(splitter) {
        if (!splitter) return;
        let dragging = false;

        const onMove = (e) => {
            if (!dragging) return;
            const mainColumn = document.getElementById("mainColumn");
            if (!mainColumn) return;
            const bottom = mainColumn.getBoundingClientRect().bottom;
            const next = bottom - e.clientY;
            applyGraphHeight(next, { persist: false });
            resizeAfterPanelChange();
        };

        const onUp = (e) => {
            if (!dragging) return;
            dragging = false;
            document.body.classList.remove("is-resizing-graph");
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            const chrome = document.getElementById("bottomChrome");
            if (chrome) applyGraphHeight(chrome.getBoundingClientRect().height, { persist: true });
            resizeAfterPanelChange();
            try {
                splitter.releasePointerCapture(e.pointerId);
            } catch (_) { /* ignore */ }
        };

        splitter.addEventListener("pointerdown", (e) => {
            if (isGraphCollapsed() || e.button !== 0) return;
            e.preventDefault();
            dragging = true;
            document.body.classList.add("is-resizing-graph");
            // Expanding from peek: ensure graph is open if somehow collapsed mid-gesture
            if (isGraphCollapsed()) setGraphCollapsed(false);
            splitter.setPointerCapture(e.pointerId);
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
            window.addEventListener("pointercancel", onUp);
        });

        splitter.addEventListener("keydown", (e) => {
            if (isGraphCollapsed()) return;
            const chrome = document.getElementById("bottomChrome");
            if (!chrome) return;
            const step = e.shiftKey ? 40 : 16;
            if (e.key === "ArrowUp") {
                e.preventDefault();
                applyGraphHeight(chrome.getBoundingClientRect().height + step);
                resizeAfterPanelChange();
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                applyGraphHeight(chrome.getBoundingClientRect().height - step);
                resizeAfterPanelChange();
            }
        });
    }

    function setSideCollapsed(collapsed) {
        document.body.classList.toggle("panel-side-collapsed", Boolean(collapsed));
        syncSideUi();
        resizeAfterPanelChange();
    }

    function setGraphCollapsed(collapsed) {
        document.body.classList.toggle("panel-graph-collapsed", Boolean(collapsed));
        syncGraphUi();
        resizeAfterPanelChange();
    }

    function expandAllPanels() {
        document.body.classList.remove("panel-side-collapsed", "panel-graph-collapsed");
        syncSideUi();
        syncGraphUi();
        resizeAfterPanelChange();
    }

    /** New video: side rail open, frame graph expanded. */
    function resetPanelsForNewVideo() {
        document.body.classList.remove("panel-side-collapsed", "panel-graph-collapsed");
        syncSideUi();
        syncGraphUi();
        resizeAfterPanelChange();
    }

    function getPeekChartHeight() {
        return PEEK_CHART_HEIGHT;
    }

    document.addEventListener("DOMContentLoaded", () => {
        const sideToggle = document.getElementById("sideRailToggle");
        const sideExpand = document.getElementById("sideRailExpand");
        const graphToggle = document.getElementById("graphPanelToggle");

        loadSavedSizes();
        bindVerticalSplitter(document.getElementById("sideRailSplitter"));
        bindHorizontalSplitter(document.getElementById("graphSplitter"));

        if (sideToggle) {
            sideToggle.addEventListener("click", () => setSideCollapsed(!isSideCollapsed()));
        }
        if (sideExpand) {
            sideExpand.addEventListener("click", () => setSideCollapsed(false));
        }
        if (graphToggle) {
            graphToggle.addEventListener("click", () => setGraphCollapsed(!isGraphCollapsed()));
        }

        document.addEventListener("keydown", (e) => {
            if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
            const t = e.target;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
                return;
            }
            if (!document.body.classList.contains("is-loaded")) return;
            if (e.key === "]" || e.code === "BracketRight") {
                e.preventDefault();
                setSideCollapsed(!isSideCollapsed());
            } else if (e.key === "g" || e.key === "G") {
                e.preventDefault();
                setGraphCollapsed(!isGraphCollapsed());
            }
        });

        expandAllPanels();
        syncSideUi();
        syncGraphUi();
    });

    window.vidplotExpandPanels = expandAllPanels;
    window.vidplotResetPanelsForNewVideo = resetPanelsForNewVideo;
    window.vidplotSetSideCollapsed = setSideCollapsed;
    window.vidplotSetGraphCollapsed = setGraphCollapsed;
    window.vidplotIsGraphCollapsed = isGraphCollapsed;
    window.vidplotGetPeekChartHeight = getPeekChartHeight;
})();
