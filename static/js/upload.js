document.addEventListener("DOMContentLoaded", function () {
    const uploadForm = document.getElementById("uploadForm");

    uploadForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const formData = new FormData(uploadForm);

        fetch("/upload", {
            method: "POST",
            body: formData,
        })
        .then(response => response.json())
        .then(result => {
            if (result.error) {
                alert("Upload error: " + result.error);
            } else {
                alert(result.message);
                
                // Update the video source with the uploaded video
                const videoSource = document.getElementById("videoSource");
                videoSource.src = result.video_url;
                const videoPlayer = document.getElementById("videoPlayer");
                videoPlayer.load(); // Reload the video player

                // Fetch and use the JSON file to update the Plotly chart
                fetch(result.json_url)
                    .then(response => response.json())
                    .then(jsonData => {
                        console.log("FFprobe JSON data:", jsonData);
                        setupPlotlyChart(jsonData);
                    })
                    .catch(err => console.error("Error fetching JSON:", err));
            }
        })
        .catch(err => {
            console.error("Upload error:", err);
        });
    });
});
