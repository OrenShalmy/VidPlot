function updateOverlayText(jsonData) {
  const overlayText = document.getElementById('overlayText');
  const duration = jsonData.streams[0].duration;
  const bitRate = jsonData.streams[0].bit_rate;
  const fps = parseFloat(jsonData.streams[0].r_frame_rate).toFixed(2);
  const formatName = jsonData.format.format_name;
  const codecName = jsonData.streams[0].codec_name;
  const width = jsonData.streams[0].width;
  const height = jsonData.streams[0].height;
  const profile = jsonData.streams[0].profile;
  const level = jsonData.streams[0].level;
  const pixFormat = jsonData.streams[0].pix_fmt;

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

  overlayText.innerHTML = `
  <p>Format: ${formatName}</p>
  <p>Codec: ${codecName}</p>
  <p>Duration: ${parseInt(duration).toFixed(2)} seconds</p>
  <p>Resolution: ${width}x${height}</p>
  <p>Frame Rate: ${parseInt(fps).toFixed(2)} fps</p>
  <p>Bit Rate: ${(parseInt(bitRate) / 1024).toFixed(2)} kb/s</p>
  <p>GOP Size: ${gopSize} frames</p>
  <p>Profile: ${profile}</p>
  <p>Level: ${level}</p>
  <p>Pixel Format: ${pixFormat}</p>
  `;
}