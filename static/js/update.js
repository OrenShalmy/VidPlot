document.addEventListener("DOMContentLoaded", function () {
    const checkBtn = document.getElementById("checkUpdateBtn");
    const statusEl = document.getElementById("updateStatus");
    const versionHint = document.getElementById("appVersionHint");
    if (!checkBtn || !statusEl) return;

    const RELEASES_API = "https://api.github.com/repos/OrenShalmy/VidPlot/releases/latest";
    const RELEASES_PAGE = "https://github.com/OrenShalmy/VidPlot/releases/latest";

    let currentVersion = window.vidplotDesktop?.version || "";

    function setStatus(message, type) {
        statusEl.textContent = message || "";
        statusEl.classList.remove("is-error", "is-success");
        if (type) statusEl.classList.add(type);
    }

    function setVersionHint(version) {
        if (!versionHint) return;
        versionHint.textContent = version ? `Installed: VidPlot ${version}` : "";
    }

    function parseVersion(value) {
        const match = String(value || "").trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
        if (!match) return null;
        return [Number(match[1]), Number(match[2]), Number(match[3])];
    }

    function compareVersions(a, b) {
        const left = parseVersion(a);
        const right = parseVersion(b);
        if (!left || !right) return 0;
        for (let i = 0; i < 3; i += 1) {
            if (left[i] !== right[i]) return left[i] - right[i];
        }
        return 0;
    }

    function loadCurrentVersion() {
        if (window.vidplotDesktop?.version) {
            currentVersion = window.vidplotDesktop.version;
            setVersionHint(currentVersion);
            return Promise.resolve(currentVersion);
        }
        return fetch("/api/env")
            .then((res) => res.json())
            .then((env) => {
                currentVersion = env.version || currentVersion;
                setVersionHint(currentVersion);
                return currentVersion;
            })
            .catch(() => currentVersion);
    }

    function fetchLatestReleaseWeb() {
        return fetch(RELEASES_API, {
            headers: { Accept: "application/vnd.github+json" },
        }).then(async (res) => {
            if (!res.ok) {
                throw new Error(`GitHub returned ${res.status}`);
            }
            return res.json();
        });
    }

    function buildWebResult(release, version) {
        const tag = String(release.tag_name || "").trim();
        const latestVersion = tag.replace(/^v/i, "") || tag;
        const assets = Array.isArray(release.assets) ? release.assets : [];
        const download = assets.find((asset) => /\.(zip|exe|AppImage)$/i.test(asset.name || ""));
        return {
            ok: true,
            currentVersion: version,
            latestVersion,
            latestTag: tag,
            updateAvailable: compareVersions(latestVersion, version) > 0,
            releasesUrl: release.html_url || RELEASES_PAGE,
            downloadUrl: download?.browser_download_url || release.html_url || RELEASES_PAGE,
            downloadName: download?.name || "",
        };
    }

    function offerUpdateWeb(info) {
        if (!info.updateAvailable) {
            setStatus(`Up to date (${info.currentVersion}).`, "is-success");
            return;
        }
        const detail = [
            `Latest release: ${info.latestTag || info.latestVersion}.`,
            info.downloadName ? `Suggested download: ${info.downloadName}` : "",
        ].filter(Boolean).join("\n");
        const download = window.confirm(
            `VidPlot ${info.latestVersion} is available.\n\nYou have ${info.currentVersion}.\n${detail}\n\nOpen the download page now?`
        );
        if (download) {
            window.open(info.downloadUrl || info.releasesUrl || RELEASES_PAGE, "_blank", "noopener,noreferrer");
            setStatus("Opened download in your browser.", "is-success");
            return;
        }
        setStatus(`Update available: ${info.latestVersion}.`, "is-success");
    }

    async function runUpdateCheck() {
        checkBtn.disabled = true;
        setStatus("Checking GitHub Releases…");
        try {
            await loadCurrentVersion();
            if (window.vidplotDesktop?.checkForUpdate) {
                const info = await window.vidplotDesktop.checkForUpdate();
                if (!info?.ok) {
                    setStatus(info?.error || "Update check failed", "is-error");
                    if (window.vidplotDesktop.offerUpdate) {
                        await window.vidplotDesktop.offerUpdate(info);
                    }
                    return;
                }
                if (info.updateAvailable) {
                    setStatus(`Update available: ${info.latestVersion}`, "is-success");
                } else {
                    setStatus(`Up to date (${info.currentVersion}).`, "is-success");
                }
                if (window.vidplotDesktop.offerUpdate) {
                    await window.vidplotDesktop.offerUpdate(info);
                }
                return;
            }

            const release = await fetchLatestReleaseWeb();
            const info = buildWebResult(release, currentVersion || "0.0.0");
            offerUpdateWeb(info);
        } catch (err) {
            setStatus(err.message || "Update check failed", "is-error");
        } finally {
            checkBtn.disabled = false;
        }
    }

    checkBtn.addEventListener("click", () => {
        runUpdateCheck();
    });

    loadCurrentVersion();
});
