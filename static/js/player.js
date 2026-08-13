document.addEventListener("DOMContentLoaded", function () {
    const video = document.getElementById("videoPlayer");
    const playPauseBtn = document.getElementById("playPauseBtn");
    const seekBar = document.getElementById("seekBar");
    const playerTime = document.getElementById("playerTime");
    if (!video || !playPauseBtn || !seekBar || !playerTime) return;

    let seeking = false;

    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) seconds = 0;
        const total = Math.floor(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) {
            return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        }
        return `${m}:${String(s).padStart(2, "0")}`;
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
        playerTime.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
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
        playerTime.textContent = `${formatTime(t)} / ${formatTime(duration)}`;
    });

    updatePlayState();
    updateTimeUI();
});
