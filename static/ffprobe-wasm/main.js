const worker = new Worker('/ffprobe-worker.js');

// Setup DOM elements and event handlers
document.addEventListener('DOMContentLoaded', function() {
	const fileInput = document.getElementById('fileInput');
	const resultDiv = document.getElementById('result');
	const loadingDiv = document.getElementById('loading');

	if (!fileInput || !resultDiv || !loadingDiv) {
		console.error('Required DOM elements not found');
		return;
	}

	// Handle file selection
	fileInput.addEventListener('change', function(event) {
		const file = event.target.files && event.target.files[0];
		if (!file) return;

		try {
			// Show loading indicator
			loadingDiv.classList.remove('d-none');
			resultDiv.innerHTML = '';

			// Send data to worker
			worker.postMessage(['get_file_info', file]);
		} catch (error) {
			loadingDiv.classList.add('d-none');
			resultDiv.innerHTML = '<div class="alert alert-danger">Error processing file: ' + error.message + '</div>';
		}
	});

	// Handle worker messages
	worker.onmessage = function(e) {
		loadingDiv.classList.add('d-none');

		if (e.data.error) {
			resultDiv.innerHTML = '<div class="alert alert-danger">Error: ' + e.data.error + '</div>';
			return;
		}

		// Format the duration if available
		const duration = e.data.format && e.data.format.duration;
		const formattedDuration = duration ? formatDuration(duration) : 'Unknown';

		// Display the results
		resultDiv.innerHTML = 
			'<div class="alert alert-success">' +
			'<h4>File Analysis Results:</h4>' +
			'<p><strong>Duration:</strong> ' + formattedDuration + '</p>' +
			'<p><strong>Format:</strong> ' + (e.data.format && e.data.format.format_name || 'Unknown') + '</p>' +
			'<p><strong>Size:</strong> ' + formatFileSize(e.data.format && e.data.format.size || 0) + '</p>' +
			'<details>' +
			'<summary>Show full details</summary>' +
			'<pre class="mt-3">' + JSON.stringify(e.data, null, 2) + '</pre>' +
			'</details>' +
			'</div>';
	};

	// Handle worker errors
	worker.onerror = function(error) {
		loadingDiv.classList.add('d-none');
		resultDiv.innerHTML = '<div class="alert alert-danger">Worker error: ' + error.message + '</div>';
	};
});

// Helper function to format duration
function formatDuration(seconds) {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainingSeconds = Math.floor(seconds % 60);
	return padZero(hours) + ':' + padZero(minutes) + ':' + padZero(remainingSeconds);
}

// Helper function to pad zeros
function padZero(num) {
	return num.toString().padStart(2, '0');
}

// Helper function to format file size
function formatFileSize(bytes) {
	if (bytes === 0) return '0 Bytes';
	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

