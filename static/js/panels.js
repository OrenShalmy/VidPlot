(function () {
    const PEEK_CHART_HEIGHT = 72;

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
    }

    function syncGraphUi() {
        const collapsed = isGraphCollapsed();
        const toggle = document.getElementById("graphPanelToggle");
        if (toggle) {
            toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
            const label = toggle.querySelector(".panel-fold-label");
            if (label) label.textContent = collapsed ? "Expand" : "Fold";
            toggle.title = collapsed ? "Expand frame graph" : "Fold frame graph";
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

    /** New video: side rail open, frame graph collapsed (playhead peek). */
    function resetPanelsForNewVideo() {
        document.body.classList.remove("panel-side-collapsed");
        document.body.classList.add("panel-graph-collapsed");
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
    });

    window.vidplotExpandPanels = expandAllPanels;
    window.vidplotResetPanelsForNewVideo = resetPanelsForNewVideo;
    window.vidplotSetSideCollapsed = setSideCollapsed;
    window.vidplotSetGraphCollapsed = setGraphCollapsed;
    window.vidplotIsGraphCollapsed = isGraphCollapsed;
    window.vidplotGetPeekChartHeight = getPeekChartHeight;
})();
