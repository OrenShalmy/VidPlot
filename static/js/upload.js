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
    
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentCompleted = Math.round((event.loaded * 100) / event.total);
                progressBar.style.width = percentCompleted + '%';
            }
        };

        xhr.onload = function() {
            if (xhr.status === 200) {
                const result = JSON.parse(xhr.responseText);
                if (result.error) {
                    alert("Upload error: " + result.error);
                } else {
                    // Hide progress bar
                    progressContainer.style.display = 'none';
                    
                    dropArea.style.display = "none";
                videoPlayer.style.display = "block";
                overlayText.style.display = "block";

                videoSource.src = result.video_url;
                videoPlayer.load();

                videoPlayer.addEventListener("loadedmetadata", function() {
                    document.querySelectorAll("th").forEach(function(th) {
                        th.style.display = "table-cell";
                    });
                });
    
                fetch(result.json_url)
                    .then(response => response.json())
                    .then(jsonData => {
                        console.log("FFprobe JSON data:", jsonData);
                        updateOverlayText(jsonData);
                        setupPlotlyChart(jsonData);
                    })
                    .catch(err => console.error("Error fetching JSON:", err));
                }
            }
        };

        xhr.onerror = function() {
            console.error("Upload error:", xhr.statusText);
            // Hide progress bar on error
            progressContainer.style.display = 'none';
        };

        xhr.send(formData);
    }    
});
