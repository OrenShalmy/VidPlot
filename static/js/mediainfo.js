function updateOverlayText(jsonData) {
    const overlayText = document.getElementById('overlayText');
    const duration = jsonData.streams[0].duration;
    const bitRate = jsonData.streams[0].bit_rate;
    const kbps = bitRate / 1024;
    const fps = parseFloat(jsonData.streams[0].r_frame_rate).toFixed(2);
    const codecName = jsonData.streams[0].codec_name;
    const width = jsonData.streams[0].width;
    const height = jsonData.streams[0].height;
    const profile = jsonData.streams[0].profile;
    const level = jsonData.streams[0].level;
    const pixFormat = jsonData.streams[0].pix_fmt;
  
    overlayText.innerHTML = `
        <p>Duration: ${duration}</p>
        <p>Bit Rate: ${kbps} kb/s</p>
        <p>Resolution: ${width}x${height}</p>
        <p>Frame Rate: ${fps} fps</p>
        <p>Codec: ${codecName}</p>
        <p>Profile: ${profile}</p>
        <p>Level: ${level}</p>
        <p>Pixel Format: ${pixFormat}</p>
    `;
  }