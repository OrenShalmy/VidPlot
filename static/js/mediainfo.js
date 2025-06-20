function updatemediaInfo(jsonData) {
  const mediaInfo = document.getElementById('mediaInfo');
  if (!mediaInfo) return;
  const duration = jsonData.streams[0].duration;
  const bitRate = jsonData.streams[0].bit_rate;
  const fps = parseFloat(jsonData.streams[0].r_frame_rate).toFixed(2);
  const formatName = jsonData.format.format_name;
  const fileSize = (jsonData.format.file_size / (1024 * 1024)).toFixed(2); // Convert to MB
  const codecName = jsonData.streams[0].codec_name;
  const width = jsonData.streams[0].width;
  const height = jsonData.streams[0].height;
  const profile = jsonData.streams[0].profile;
  const level = (jsonData.streams[0].level / 10).toFixed(1);
  const pixFormat = jsonData.streams[0].pix_fmt;
  const bitsPerPixel = jsonData.streams[0].bits_per_raw_sample;
  const fieldOrder = jsonData.streams[0].field_order || 'progressive';

  // Find GOP size by analyzing I-frame positions
  function detectGOP(frames) {
    // Get indices of I-frames
    const iFrameIndices = frames
      .map((frame, index) => frame.pict_type === 'I' ? index : -1)
      .filter(index => index !== -1);

    if (iFrameIndices.length < 2) return 'N/A';

    // Calculate distances between consecutive I-frames
    const distances = [];
    for (let i = 1; i < iFrameIndices.length; i++) {
      distances.push(iFrameIndices[i] - iFrameIndices[i-1]);
    }

    // Find the most common distance (GOP size)
    const frequencyMap = {};
    let maxFreq = 0;
    let mostCommonGOP = 0;

    distances.forEach(distance => {
      frequencyMap[distance] = (frequencyMap[distance] || 0) + 1;
      if (frequencyMap[distance] > maxFreq) {
        maxFreq = frequencyMap[distance];
        mostCommonGOP = distance;
      }
    });

    // Only return GOP if it appears consistently
    const consistency = maxFreq / distances.length;
    return consistency > 0.5 ? mostCommonGOP : 'Variable';
  }

  const gopSize = detectGOP(jsonData.frames);

  // Get filename from video source
  const videoSource = document.getElementById('videoSource');
  const filename = videoSource.src ? decodeURIComponent(videoSource.src.split('/').pop()) : 'Unknown File';

  mediaInfo.innerHTML = `
    <div class="info-section">
      <h3>Video Properties for ${filename}</h3>
      <div class="info-item">
        <span class="label">File Size:</span>
        <span class="value">${fileSize} MB</span>
        </div>
      <div class="info-item">
        <span class="label">Container:</span>
        <span class="value">${formatName}</span>
        </div>
        <div class="info-item">
        <span class="label">Codec:</span>
        <span class="value">${codecName}</span>
      </div>
        <div class="info-item">
        <span class="label">Profile:</span>
        <span class="value">${profile}@L${level}</span>
        </div>

      <div class="info-item">
        <span class="label">Resolution:</span>
        <span class="value">${width}x${height}</span>
      </div>
      <div class="info-item">
        <span class="label">Duration:</span>
        <span class="value">${parseInt(duration).toFixed(2)}s</span>
      </div>
      <div class="info-item">
        <span class="label">Frame Rate:</span>
        <span class="value">${parseInt(fps)} fps</span>
      </div>
      <div class="info-item">
        <span class="label">Bit Rate:</span>
        <span class="value">${(parseInt(bitRate) / 1024).toFixed(2)} kb/s</span>
      </div>
      <div class="info-item">
        <span class="label">GOP Size:</span>
        <span class="value">${gopSize} frames</span>
      </div>
      <div class="info-item">
        <span class="label">Pixel Format:</span>
        <span class="value">${pixFormat}</span>
      </div>
      <div class="info-item">
        <span class="label">Bits per Pixel:</span>
        <span class="value">${bitsPerPixel}</span>
      </div>
      <div class="info-item">
        <span class="label">Scan Type:</span>
        <span class="value">${fieldOrder}</span>
      </div>
    </div>
  `;

  // Toggle logic for info panel
  const toggleBtn = document.getElementById('toggleInfoBtn');
  if (toggleBtn) {
    toggleBtn.onclick = function() {
      mediaInfo.classList.toggle('hide');
    };
  }
  // Show info panel by default
  mediaInfo.classList.remove('hide');
}