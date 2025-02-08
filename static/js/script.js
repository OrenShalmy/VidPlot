function handleFileUpload(file) {
	// Create object URL for the uploaded file
	const videoURL = URL.createObjectURL(file);
	
	// Get the video player and overlay text elements
	const videoPlayer = document.getElementById('videoPlayer');
	const overlayText = document.getElementById('overlayText');
	const dropArea = document.getElementById('dropArea');
	
	// Set the video source
	videoPlayer.src = videoURL;
	
	// Show both the video player and overlay text
	videoPlayer.style.display = 'block';
	overlayText.style.display = 'block';
	
	// Hide the drop area
	dropArea.style.display = 'none';
	
	// Start playing the video
	videoPlayer.play();
}

// Handle drag and drop events
const dropArea = document.getElementById('dropArea');

dropArea.addEventListener('dragover', (e) => {
	e.preventDefault();
});

dropArea.addEventListener('drop', (e) => {
	e.preventDefault();
	const file = e.dataTransfer.files[0];
	if (file.type.startsWith('video/')) {
		handleFileUpload(file);
	}
});

// Handle file input
const fileInput = document.querySelector('input[type="file"]');
if (fileInput) {
	fileInput.addEventListener('change', (e) => {
		const file = e.target.files[0];
		if (file.type.startsWith('video/')) {
			handleFileUpload(file);
		}
	});
}