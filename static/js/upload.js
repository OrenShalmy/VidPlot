document.addEventListener("DOMContentLoaded", function () {
    const dropArea = document.getElementById("dropArea");
    const videoUpload = document.getElementById("videoUpload");
    const videoPlayer = document.getElementById("videoPlayer");
    const videoSource = document.getElementById("videoSource");

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
    
        fetch("/upload", {
            method: "POST",
            body: formData,
        })
        .then(response => response.json())
        .then(result => {
            if (result.error) {
                alert("Upload error: " + result.error);
            } else {
                // alert(result.message);
    
                // Hide uploader, show video player
                dropArea.style.display = "none";
                videoPlayer.style.display = "block"; // Make sure the video player is shown

                videoSource.src = result.video_url;
                videoPlayer.load();

                videoPlayer.addEventListener("loadedmetadata", function() {
                    document.querySelectorAll("th").forEach(function(th) {
                      th.style.display = "table-cell";
                    });
                  });
    
                // Fetch and update Plotly chart
                fetch(result.json_url)
                    .then(response => response.json())
                    .then(jsonData => {
                        console.log("FFprobe JSON data:", jsonData);
                        updateOverlayText(jsonData);
                        setupPlotlyChart(jsonData);
                    })
                    .catch(err => console.error("Error fetching JSON:", err));
            }
        })
        .catch(err => console.error("Upload error:", err));
    }    
});
