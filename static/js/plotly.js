    function setupPlotlyChart(jsonData) {
        let currentView = 'bar'; // or 'line'

        const togglesDiv = document.querySelector('div.toggles');
        togglesDiv.innerHTML += `
            <button id="barView" class="view-switcher active">Bar View</button>
            <button id="lineView" class="view-switcher">Line View</button>
        `;
        togglesDiv.style.visibility = 'visible';

        function bytesToMbps(bytes, duration) {
            return (bytes * 8) / (1024 * 1024 * duration);
        }

        const frameRate = eval(jsonData.streams[0].r_frame_rate);
        const frameDuration = 1 / frameRate;

        document.addEventListener('keydown', (event) => {
            if (!videoPlayer.paused) {
                videoPlayer.pause();
            }
            
            switch(event.key) {
                case 'ArrowLeft':
                    event.preventDefault();
                    videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - frameDuration);
                    break;
                case 'ArrowRight':
                    event.preventDefault();
                    videoPlayer.currentTime = Math.min(
                        videoPlayer.duration,
                        videoPlayer.currentTime + frameDuration
                    );
                    break;
            }
        });

      const iFrames = jsonData.frames.filter(frame => frame.pict_type === 'I');
      const pFrames = jsonData.frames.filter(frame => frame.pict_type === 'P');
      const bFrames = jsonData.frames.filter(frame => frame.pict_type === 'B');

      const bitRate = jsonData.streams[0].bit_rate;
      const mbps = bitRate / (1024 * 1000);

      function createTraces(type) {
          if (type === 'bar') {
              return [
                  {
                      x: iFrames.map(f => parseFloat(f.best_effort_timestamp_time)),
                      y: iFrames.map(f => bytesToMbps(parseInt(f.pkt_size), frameDuration)),
                      type: 'bar',
                      name: 'I-Frames',
                      marker: { color: '#0161ff' },
                      hovertemplate: "Timestamp: %{x:.4f} s<br>Size: %{y:.2f} Mb<br>Type: I"
                  },
                  {
                      x: pFrames.map(f => parseFloat(f.best_effort_timestamp_time)),
                      y: pFrames.map(f => bytesToMbps(parseInt(f.pkt_size), frameDuration)),
                      type: 'bar',
                      name: 'P-Frames',
                      marker: { color: '#70a6ff' },
                      hovertemplate: "Timestamp: %{x:.4f} s<br>Size: %{y:.2f} Mb<br>Type: P"
                  },
                  {
                      x: bFrames.map(f => parseFloat(f.best_effort_timestamp_time)),
                      y: bFrames.map(f => bytesToMbps(parseInt(f.pkt_size), frameDuration)),
                      type: 'bar',
                      name: 'B-Frames',
                      marker: { color: '#ffffff' },
                      hovertemplate: "Timestamp: %{x:.4f} s<br>Size: %{y:.2f} Mb<br>Type: B"
                  }
              ];
          } else {
              const allFrames = [...jsonData.frames].sort((a, b) => 
                  parseFloat(a.best_effort_timestamp_time) - parseFloat(b.best_effort_timestamp_time)
              );
              
              return [{
                  x: allFrames.map(f => parseFloat(f.best_effort_timestamp_time)),
                  y: allFrames.map(f => bytesToMbps(parseInt(f.pkt_size), frameDuration)),
                  type: 'scatter',
                  mode: 'lines',
                  name: 'Overall Bitrate',
                  line: { color: '#70a6ff', width: 2 },
                  hovertemplate: "Timestamp: %{x:.4f} s<br>Bitrate: %{y:.2f} Mb/s"
              }];
          }
      }

      let traces = createTraces('bar');

      const layout = {
        title: '',
        xaxis: { title: 'Timestamp (seconds)' },
        yaxis: { title: 'Frame Size (Mb)', gridcolor: '#444' },
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
        autosize: true,
        margin: {
            l: 50,
            r: 50,
            t: 10,
            b: 40
        },
        shapes: [
            {
                type: 'line',
                xref: 'paper',
                x0: 0,
                x1: 1,
                yref: 'y',
                y0: mbps,
                y1: mbps,
                line: {
                    color: '#f200ff',
                    width: 2,
                    dash: 'dash'
                },
            }
        ],
        annotations: [
            {
                xref: 'paper',
                yref: 'y',
                x: 0,  // Position annotation near the right side
                y: mbps,   // Align with the average bitrate line
                text: `Average Bitrate: ${mbps.toFixed(2)} Mb/s`,
                showarrow: false,
                font: {
                    size: 12,
                    color: '#f200ff'
                },
                bgcolor: '#282828',
                bordercolor: '#f200ff',
                borderwidth: 1,
                borderpad: 4,
                opacity: 0.8,
            }
        ]
    };
    

      Plotly.newPlot('frameChart', traces, layout, {
        displaylogo: false,
        annotations: true,
        responsive: true,
        useResizeHandler: true,
        modeBarButtonsToRemove: [
          'select2d',
          'lasso2d', 
          'autoScale2d',
          'toggleSpikelines'
        ],
      }).then(() => {
          const chartDiv = document.getElementById('frameChart');
          chartDiv.on('plotly_click', function(data) {
            if (data.points && data.points.length > 0) {
              const clickedTime = parseFloat(data.points[0].x);
              videoPlayer.currentTime = clickedTime;
            }
          });
      });

      document.getElementById('barView').addEventListener('click', function() {
          if (currentView !== 'bar') {
              currentView = 'bar';
              Plotly.react('frameChart', createTraces('bar'), layout);
              document.getElementById('barView').classList.add('active');
              document.getElementById('lineView').classList.remove('active');
          }
      });

      document.getElementById('lineView').addEventListener('click', function() {
          if (currentView !== 'line') {
              currentView = 'line';
              Plotly.react('frameChart', createTraces('line'), layout);
              document.getElementById('lineView').classList.add('active');
              document.getElementById('barView').classList.remove('active');
          }
      });


      const tableBody = document.querySelector('table tbody');
      tableBody.innerHTML = '';
      jsonData.frames.forEach(frame => {
        const row = tableBody.insertRow();
        const timestampCell = row.insertCell();
        const pktSizeCell = row.insertCell();
        const pictTypeCell = row.insertCell();

        timestampCell.textContent = parseFloat(frame.best_effort_timestamp_time).toFixed(4);
        pktSizeCell.textContent = bytesToMbps(parseInt(frame.pkt_size), frameDuration).toFixed(2) + ' Mb';
        pictTypeCell.textContent = frame.pict_type;
      });

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
    }