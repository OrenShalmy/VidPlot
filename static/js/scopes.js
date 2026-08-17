document.addEventListener("DOMContentLoaded", function () {
    const video = document.getElementById("videoPlayer");
    const stage = document.getElementById("videoStage");
    const preview = document.getElementById("scopePreview");
    const statusEl = document.getElementById("scopeStatus");
    const toggles = Array.from(document.querySelectorAll(".scope-toggle[data-scope]"));
    if (!video || !stage || !preview || !toggles.length) return;

    const active = new Set();
    let abortController = null;
    let objectUrl = null;
    let requestToken = 0;
    let playTimer = null;
    let lastRequestKey = "";

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
    }

    async function refreshScopes(force) {
        const filters = selectedFilters();
        if (!filters.length) {
            clearPreview();
            return;
        }
        const path = sourcePath();
        if (!path) {
            setStatus("No source path for scopes", true);
            return;
        }
        const time = Number(video.currentTime) || 0;
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
            setStatus(err.message || "Scope preview failed", true);
        }
    }

    function schedulePlayRefresh() {
        if (playTimer) return;
        playTimer = setTimeout(() => {
            playTimer = null;
            if (!video.paused && active.size) refreshScopes(false);
        }, 350);
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

    video.addEventListener("seeked", () => {
        if (active.size) refreshScopes(true);
    });
    video.addEventListener("timeupdate", () => {
        if (active.size && !video.paused) schedulePlayRefresh();
    });
    video.addEventListener("pause", () => {
        if (active.size) refreshScopes(true);
    });

    window.vidplotResetScopes = function () {
        active.clear();
        syncToggleUi();
        clearPreview();
    };
    window.vidplotRefreshScopes = function () {
        if (active.size) refreshScopes(true);
    };

    syncToggleUi();
});
