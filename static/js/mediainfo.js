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
    overlayText.innerHTML = `
    <p>Format: ${formatName}</p>
    <p>Codec: ${codecName}</p>
    <p>Duration: ${parseInt(duration).toFixed(2)} seconds</p>
    <p>Resolution: ${width}x${height}</p>
    <p>Frame Rate: ${parseInt(fps).toFixed(2)} fps</p>
    <p>Bit Rate: ${(parseInt(bitRate) / 1024).toFixed(2)} kb/s</p>
    <p>Profile: ${profile}</p>
    <p>Level: ${level}</p>
    <p>Pixel Format: ${pixFormat}</p>
    `;
  }