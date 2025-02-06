function updateOverlayText(jsonData) {
    const overlayText = document.getElementById('overlayText');
    const width = jsonData.streams[0].width;
    const height = jsonData.streams[0].height;
    const fps = parseFloat(jsonData.streams[0].r_frame_rate).toFixed(2);
    const duration = jsonData.streams[0].duration;
    const pixFormat = jsonData.streams[0].pix_fmt;
    const codecName = jsonData.streams[0].codec_name;
    const profile = jsonData.streams[0].profile;
    const level = jsonData.streams[0].level;
  
    overlayText.innerHTML = `
      <p>Resolution: ${width}x${height}</p>
      <p>Frame Rate: ${fps} fps</p>
      <p>Duration: ${duration}</p>
      <p>Pixel Format: ${pixFormat}</p>
      <p>Codec: ${codecName}</p>
      <p>Profile: ${profile}</p>
      <p>Level: ${level}</p>
    `;
  }