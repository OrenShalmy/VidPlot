document.addEventListener("DOMContentLoaded", function () {
    const video = document.getElementById("videoPlayer");
    const playPauseBtn = document.getElementById("playPauseBtn");
    const seekBar = document.getElementById("seekBar");
    const playerTime = document.getElementById("playerTime");
    const timeDisplayMode = document.getElementById("timeDisplayMode");
    if (!video || !playPauseBtn || !seekBar || !playerTime) return;

    let seeking = false;
    const TIME_MODES = ["seconds", "timecode", "timestamp", "frames"];
    const TIME_MODE_KEY = "vidplotTimeDisplayMode";

    function loadTimeMode() {
        const saved = localStorage.getItem(TIME_MODE_KEY);
        if (TIME_MODES.includes(saved)) return saved;
        return "seconds";
    }

    let timeMode = loadTimeMode();
    if (timeDisplayMode) {
        timeDisplayMode.value = timeMode;
        timeDisplayMode.addEventListener("change", () => {
            timeMode = timeDisplayMode.value;
            if (!TIME_MODES.includes(timeMode)) timeMode = "seconds";
            localStorage.setItem(TIME_MODE_KEY, timeMode);
            updateTimeUI();
        });
    }

    function pad2(n) {
        return String(n).padStart(2, "0");
    }

    function pad3(n) {
        return String(n).padStart(3, "0");
    }

    function getFps() {
        if (typeof estimateJsonFps === "function") {
            return estimateJsonFps(window.vidplotJsonData);
        }
        const jsonData = window.vidplotJsonData;
        const stream = (jsonData?.streams || []).find((s) => s.codec_type === "video") || {};
        const rate = stream.avg_frame_rate || stream.r_frame_rate;
        if (rate && String(rate).includes("/")) {
            const [a, b] = String(rate).split("/").map(Number);
            if (b && a) return a / b;
        }
        const n = parseFloat(rate);
        return Number.isFinite(n) && n > 0 ? n : 25;
    }

    function getFrameCount(duration, fps) {
        const frames = window.vidplotJsonData?.frames;
        if (Array.isArray(frames) && frames.length > 0) return frames.length;
        if (Number.isFinite(duration) && duration > 0 && fps > 0) {
            return Math.max(1, Math.round(duration * fps));
        }
        return 0;
    }

    function findFrameIndex(timeSec, fps) {
        const frames = window.vidplotJsonData?.frames;
        if (Array.isArray(frames) && frames.length > 0) {
            let closestIdx = 0;
            let minDiff = Infinity;
            frames.forEach((frame, idx) => {
                const timestamp = parseFloat(frame.best_effort_timestamp_time);
                if (!Number.isFinite(timestamp)) return;
                const diff = Math.abs(timeSec - timestamp);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIdx = idx;
                }
            });
            return closestIdx;
        }
        return Math.max(0, Math.round(Math.max(0, timeSec) * fps));
    }

    /** Compact seconds: 0:09 or 1:23:45 */
    function formatSeconds(seconds) {
        if (!isFinite(seconds) || seconds < 0) seconds = 0;
        const total = Math.floor(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) {
            return `${h}:${pad2(m)}:${pad2(s)}`;
        }
        return `${m}:${pad2(s)}`;
    }

    /** Timecode HH:MM:SS.FF (frames) */
    function formatTimecode(seconds, fps) {
        if (typeof formatFrameTimecode === "function") {
            return formatFrameTimecode(seconds, fps);
        }
        const t = Math.max(0, Number(seconds) || 0);
        const rate = Number.isFinite(fps) && fps > 0 ? fps : 25;
        const fpsRounded = Math.max(1, Math.round(rate));
        const totalFrames = Math.round(t * rate);
        const ff = ((totalFrames % fpsRounded) + fpsRounded) % fpsRounded;
        let rem = Math.floor(totalFrames / fpsRounded);
        const ss = rem % 60;
        rem = Math.floor(rem / 60);
        const mm = rem % 60;
        const hh = Math.floor(rem / 60);
        return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}.${pad2(ff)}`;
    }

    /** Timestamp HH:MM:SS.mmm */
    function formatTimestamp(seconds) {
        const t = Math.max(0, Number(seconds) || 0);
        const msTotal = Math.round(t * 1000);
        const ms = msTotal % 1000;
        let rem = Math.floor(msTotal / 1000);
        const ss = rem % 60;
        rem = Math.floor(rem / 60);
        const mm = rem % 60;
        const hh = Math.floor(rem / 60);
        return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}.${pad3(ms)}`;
    }

    function formatPosition(seconds, duration) {
        const fps = getFps();
        if (timeMode === "timecode") {
            return `${formatTimecode(seconds, fps)} / ${formatTimecode(duration, fps)}`;
        }
        if (timeMode === "timestamp") {
            return `${formatTimestamp(seconds)} / ${formatTimestamp(duration)}`;
        }
        if (timeMode === "frames") {
            const total = getFrameCount(duration, fps);
            const idx = Math.min(findFrameIndex(seconds, fps), Math.max(0, total - 1));
            return `${idx} / ${total}`;
        }
        return `${formatSeconds(seconds)} / ${formatSeconds(duration)}`;
    }

    function updatePlayState() {
        playPauseBtn.classList.toggle("is-playing", !video.paused && !video.ended);
    }

    function updateSeekFill(current, duration) {
        const pct = duration > 0 ? (current / duration) * 100 : 0;
        seekBar.style.background =
            `linear-gradient(to right, var(--accent) ${pct}%, rgba(255,255,255,0.12) ${pct}%)`;
    }

    function updateTimeUI() {
        const duration = isFinite(video.duration) ? video.duration : 0;
        const current = video.currentTime || 0;
        if (!seeking && duration > 0) {
            seekBar.max = String(duration);
            seekBar.value = String(current);
        }
        updateSeekFill(seeking ? parseFloat(seekBar.value) || 0 : current, duration);
        playerTime.textContent = formatPosition(current, duration);
    }

    function togglePlay() {
        if (video.paused || video.ended) {
            video.play();
        } else {
            video.pause();
        }
    }

    playPauseBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePlay();
    });

    video.addEventListener("click", () => {
        togglePlay();
    });

    video.addEventListener("play", updatePlayState);
    video.addEventListener("pause", updatePlayState);
    video.addEventListener("ended", updatePlayState);
    video.addEventListener("timeupdate", updateTimeUI);
    video.addEventListener("loadedmetadata", updateTimeUI);
    video.addEventListener("durationchange", updateTimeUI);
    video.addEventListener("seeked", updateTimeUI);

    seekBar.addEventListener("pointerdown", () => {
        seeking = true;
    });
    seekBar.addEventListener("pointerup", () => {
        seeking = false;
        updateTimeUI();
    });
    seekBar.addEventListener("input", () => {
        const t = parseFloat(seekBar.value);
        if (!isFinite(t)) return;
        video.currentTime = t;
        const duration = video.duration || 0;
        updateSeekFill(t, duration);
        playerTime.textContent = formatPosition(t, duration);
    });

    updatePlayState();
    updateTimeUI();
});
