// Function to create the Plotly chart and table from the JSON data.
    function setupPlotlyChart(jsonData) {

        // Separate data by frame type
      const iFrames = jsonData.frames.filter(frame => frame.pict_type === 'I');
      const pFrames = jsonData.frames.filter(frame => frame.pict_type === 'P');
      const bFrames = jsonData.frames.filter(frame => frame.pict_type === 'B');

      // Get media info
      const bitRate = jsonData.streams[0].bit_rate;
      const kbps = bitRate / 1024;
      const width = jsonData.streams[0].width;
      const height = jsonData.streams[0].height;
      const fps = parseFloat(jsonData.streams[0].r_frame_rate).toFixed(2);
      const duration = jsonData.streams[0].duration;
      const pixFormat = jsonData.streams[0].pix_fmt;
      const codecName = jsonData.streams[0].codec_name;
      const profile = jsonData.streams[0].profile;
      const level = jsonData.streams[0].level;

      // Create traces for each frame type
      const iTrace = {
        x: iFrames.map(f => parseFloat(f.best_effort_timestamp_time)),
        y: iFrames.map(f => parseInt(f.pkt_size)),
        mode: 'lines',
        type: 'bar',
        name: 'I-Frames',
        marker: { color: '#0161ff', size: 4 },
        line: { color: '#0161ff', width: 1 },
        hovertemplate: "Timestamp: %{x:.4f} s<br>Packet Size: %{y}<br>Type: I"
      };

      const pTrace = {
        x: pFrames.map(f => parseFloat(f.best_effort_timestamp_time)),
        y: pFrames.map(f => parseInt(f.pkt_size)),
        mode: 'lines',
        type: 'bar',
        name: 'P-Frames',
        marker: { color: '#70a6ff', size: 4 },
        line: { color: '#70a6ff', width: 1 },
        hovertemplate: "Timestamp: %{x:.4f} s<br>Packet Size: %{y}<br>Type: P"
      };

      const bTrace = {
        x: bFrames.map(f => parseFloat(f.best_effort_timestamp_time)),
        y: bFrames.map(f => parseInt(f.pkt_size)),
        mode: 'lines',
        type: 'bar',
        name: 'B-Frames',
        marker: { color: '#ffffff', size: 4 },
        line: { color: '#ffffff', width: 1 },
        hovertemplate: "Timestamp: %{x:.4f} s<br>Packet Size: %{y}<br>Type: B"
      };

      // Plot general layout
      const layout = {
        title: '',
        xaxis: { title: 'Timestamp (seconds)' },
        yaxis: { title: 'Packet Size', gridcolor: '#444' },
        plot_bgcolor: '#282828',
        paper_bgcolor: '#1e1e1e',
        font: { color: '#e0e0e0' },
        zoommode: 'x',
        dragmode: 'pan',
        legend: {
          x: 0.05,
          y: 0.95,
          font: { color: '#e0e0e0' }
        },
        height: 400,
        margin: {
          l: 50,
          r: 50,
          t: 10,
          b: 40
        },
        shapes: [
        {
        type: 'line',
        xref: 'paper',  // span the entire width of the plot area
        x0: 0,
        x1: 1,
        yref: 'y',
        y0: kbps,
        y1: kbps,
        line: {
            color: 'red',
            width: 2,
            dash: 'dash'
        }
        }
    ],
    annotations: [
        {
        xref: 'paper',
        x: 0,  // position it just to the right of the plot area
        y: kbps,
        yref: 'y',
        text: `Average Bitrate: ${kbps} kb/s`,
        showarrow: false,
        yshift: 10,
        font: {
            color: 'red'
        },
        align: 'right'
        }
    ]
    };

      // Create the Plotly chart
      Plotly.newPlot('frameChart', [iTrace, pTrace, bTrace], layout)
        .then(() => {
          const chartDiv = document.getElementById('frameChart');
          chartDiv.on('plotly_click', function(data) {
            if (data.points && data.points.length > 0) {
              const clickedTime = parseFloat(data.points[0].x);
              videoPlayer.currentTime = clickedTime;
            }
          });
        });

      // Populate the table
      const tableBody = document.querySelector('table tbody');
      tableBody.innerHTML = '';  // Clear any existing rows
      jsonData.frames.forEach(frame => {
        const row = tableBody.insertRow();
        const timestampCell = row.insertCell();
        const pktSizeCell = row.insertCell();
        const pictTypeCell = row.insertCell();

        timestampCell.textContent = frame.best_effort_timestamp_time;
        pktSizeCell.textContent = frame.pkt_size;
        pictTypeCell.textContent = frame.pict_type;
      });

      // Toggle functionality for traces
      const iFrameToggle = document.getElementById('iFrameToggle');
      const pFrameToggle = document.getElementById('pFrameToggle');
      const bFrameToggle = document.getElementById('bFrameToggle');

      function updateVisibility() {
        Plotly.restyle('frameChart', {
          visible: [
            iFrameToggle.checked,
            pFrameToggle.checked,
            bFrameToggle.checked
          ]
        }, [0, 1, 2]);
      }

      // Update chart and table highlighting on video time update
      videoPlayer.addEventListener('timeupdate', function() {
        const currentTime = videoPlayer.currentTime;
        const closestFrame = findClosestFrame(currentTime, jsonData.frames);

        if (closestFrame) {
          Plotly.relayout('frameChart', {
            xaxis: {
              range: [
                Math.max(0, parseFloat(closestFrame.best_effort_timestamp_time) - 0.2),
                parseFloat(closestFrame.best_effort_timestamp_time) + 0.2
              ]
            }
          });
          highlightTableRow(closestFrame);
        }
      });

      // Find the closest frame given a time value
      function findClosestFrame(time, frames) {
        let closestFrame = null;
        let minDiff = Infinity;
        frames.forEach(frame => {
          const timestamp = parseFloat(frame.best_effort_timestamp_time);
          const diff = Math.abs(time - timestamp);
          if (diff < minDiff) {
            minDiff = diff;
            closestFrame = frame;
          }
        });
        return closestFrame;
      }

      // Highlight the corresponding table row for the given frame
      function highlightTableRow(frame) {
        const tableBody = document.querySelector('table tbody');
        const highlightedRows = tableBody.querySelectorAll('.highlighted');
        highlightedRows.forEach(row => row.classList.remove('highlighted'));
        for (let i = 0; i < tableBody.rows.length; i++) {
          const row = tableBody.rows[i];
          const timestampCell = row.cells[0];
          if (parseFloat(timestampCell.textContent) === parseFloat(frame.best_effort_timestamp_time)) {
            row.classList.add('highlighted');
            break;
          }
        }
      }

      videoPlayer.addEventListener('play', () => {
        function updateLoop(now, metadata) {
          if (!videoPlayer.paused && !videoPlayer.ended) {
            // You can update UI elements here if needed using metadata.mediaTime
            videoPlayer.requestVideoFrameCallback(updateLoop);
          }
        }
        videoPlayer.requestVideoFrameCallback(updateLoop);
      });
    }