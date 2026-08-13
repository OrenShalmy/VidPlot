document.addEventListener("DOMContentLoaded", function () {
    const ffprobeInput = document.getElementById("ffprobePathInput");
    const ffmpegInput = document.getElementById("ffmpegPathInput");
    const saveBtn = document.getElementById("saveConfigBtn");
    const statusEl = document.getElementById("configStatus");

    if (!ffprobeInput || !ffmpegInput || !saveBtn || !statusEl) return;

    function setStatus(message, type) {
        statusEl.textContent = message || "";
        statusEl.classList.remove("is-error", "is-success");
        if (type) statusEl.classList.add(type);
    }

    function loadConfig() {
        fetch("/api/config")
            .then((res) => res.json())
            .then((data) => {
                ffprobeInput.value = data.ffprobe_path || "";
                ffmpegInput.value = data.ffmpeg_path || "";
                if (!data.ffprobe_path && data.ffprobe_resolved) {
                    ffprobeInput.placeholder = data.ffprobe_resolved;
                }
                if (!data.ffmpeg_path && data.ffmpeg_resolved) {
                    ffmpegInput.placeholder = data.ffmpeg_resolved;
                }
            })
            .catch(() => {
                setStatus("Could not load configuration", "is-error");
            });
    }

    function saveConfig() {
        setStatus("Saving…");
        saveBtn.disabled = true;
        fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ffprobe_path: ffprobeInput.value.trim(),
                ffmpeg_path: ffmpegInput.value.trim(),
            }),
        })
            .then(async (res) => {
                const data = await res.json();
                if (!res.ok) {
                    const fieldErrors = data.fields
                        ? Object.entries(data.fields)
                            .map(([key, msg]) => `${key}: ${msg}`)
                            .join("; ")
                        : data.error || "Save failed";
                    throw new Error(fieldErrors);
                }
                ffprobeInput.value = data.ffprobe_path || "";
                ffmpegInput.value = data.ffmpeg_path || "";
                setStatus("Saved", "is-success");
            })
            .catch((err) => {
                setStatus(err.message || "Save failed", "is-error");
            })
            .finally(() => {
                saveBtn.disabled = false;
            });
    }

    saveBtn.addEventListener("click", saveConfig);
    [ffprobeInput, ffmpegInput].forEach((input) => {
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                saveConfig();
            }
        });
    });

    loadConfig();
});
