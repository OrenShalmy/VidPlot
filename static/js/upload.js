document.addEventListener("DOMContentLoaded", function () {
    const dropArea = document.getElementById("dropArea");
    const videoUpload = document.getElementById("videoUpload");
    const videoPlayer = document.getElementById("videoPlayer");
    const videoSource = document.getElementById("videoSource");
    const overlayText = document.getElementById("overlayText");

    // Add progress bar HTML to dropArea
    dropArea.innerHTML += `
        <div id="uploadProgress">
            <div class="progress-bar"></div>
        </div>
    `;
    const progressBar = document.querySelector('#uploadProgress .progress-bar');
    const progressContainer = document.getElementById('uploadProgress');

    // Prevent default behavior (Prevent opening the file)
    ["dragenter", "dragover", "dragleave", "drop"].forEach(event => {
        dropArea.addEventListener(event, (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    // Highlight drop area when a file is dragged over
    ["dragenter", "dragover"].forEach(event => {
        dropArea.addEventListener(event, () => dropArea.classList.add("highlight"));
    });

    ["dragleave", "drop"].forEach(event => {
        dropArea.addEventListener(event, () => dropArea.classList.remove("highlight"));
    });

    // Handle dropped file
    dropArea.addEventListener("drop", (event) => {
        const file = event.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    // Handle file selection via click
    dropArea.addEventListener("click", () => videoUpload.click());

    videoUpload.addEventListener("change", (event) => {
        const file = event.target.files[0];
        if (file) handleFile(file);
    });

    function handleFile(file) {
        const formData = new FormData();
        formData.append("video", file);
        
        // Show progress bar
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';

        // Add progress label
        const progressLabel = document.createElement('div');
        progressLabel.id = 'progressLabel';
        progressLabel.textContent = 'Uploading...';
        progressContainer.appendChild(progressLabel);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                // Upload is 50% of total progress
                const percentCompleted = Math.round((event.loaded * 25) / event.total);
                progressBar.style.width = percentCompleted + '%';
                progressLabel.textContent = `Uploading: ${percentCompleted}%`;
            }
        };

        xhr.onload = function() {
            if (xhr.status === 200) {
                const result = JSON.parse(xhr.responseText);
                if (result.error) {
                    alert("Upload error: " + result.error);
                    progressContainer.style.display = 'none';
                } else {
                    progressBar.style.width = '75%';
                    progressLabel.textContent = 'Processing video...';
                    
                    // Start polling for JSON file
                    const pollInterval = setInterval(() => {
                        fetch(result.json_url)
                            .then(response => response.json())
                            .then(jsonData => {
                                if (jsonData.frames && jsonData.frames.length > 0) {
                                    const lastFrame = jsonData.frames[jsonData.frames.length - 1];
                                    const progress = Math.min(
                                        75 + (parseFloat(lastFrame.best_effort_timestamp_time) / result.duration) * 25,
                                        100
                                    );
                                    progressBar.style.width = progress + '%';
                                    progressLabel.textContent = `Analyzing: ${Math.round(progress)}%`;

                                    if (progress >= 99) {
                                        clearInterval(pollInterval);
                                        progressLabel.textContent = 'Complete!';
                                        setTimeout(() => {
                                            progressContainer.style.display = 'none';
                                            // Update UI
                                            dropArea.style.display = "none";
                                            document.getElementById("videoContainer").style.display = "flex";
                                            videoPlayer.style.display = "block";
                                            overlayText.style.display = "block";
                                            videoSource.src = result.video_url;
                                            videoPlayer.load();

                                            videoPlayer.addEventListener("loadedmetadata", function() {
                                                document.querySelectorAll("th").forEach(function(th) {
                                                    th.style.display = "table-cell";
                                                });
                                            });

                                            updateOverlayText(jsonData);
                                            setupPlotlyChart(jsonData);
                                        }, 1000);
                                    }
                                }
                            })
                            .catch(() => {}); // Ignore errors during polling
                    }, 500);
                }
            }
        };

        xhr.onerror = function() {
            console.error("Upload error:", xhr.statusText);
            progressContainer.style.display = 'none';
        };

        xhr.send(formData);
    }

});
