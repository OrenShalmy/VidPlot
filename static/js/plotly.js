function setupPlotlyChart(jsonData) {
    // --- Helper Functions ---
    function bytesToMbps(bytes, duration) {
        return (bytes * 8) / (1024 * 1024 * duration);
    }
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
    function updateCurrentFrameMarker(currentTime) {
        // Remove previous marker if exists
        let updateShapes = layout.shapes.filter(s => s.name !== currentFrameShapeId);
        // Add new marker
        updateShapes.push({
            type: 'line',
            xref: 'x',
            x0: currentTime,
            x1: currentTime,
            yref: 'paper',
            y0: 0,
            y1: 1,
            line: {
                color: '#ff0000',
                width: 2,
                dash: 'solid'
            },
            name: currentFrameShapeId
        });
        Plotly.relayout('frameChart', { shapes: updateShapes });
    }
    function syncSlider(currentTime) {
        if (slider) {
            slider.value = currentTime;
            sliderValue.textContent = currentTime.toFixed(2) + 's';
        }
    }

    // --- Variable Setup ---
    let currentView = 'bar';
    const currentFrameShapeId = 'current-frame-marker';
    const togglesDiv = document.querySelector('div.toggles');
    const slider = document.getElementById('frameSlider');
    const sliderValue = document.getElementById('sliderValue');
    const videoPlayer = document.getElementById('videoPlayer');
    if (!togglesDiv || !slider || !sliderValue || !videoPlayer) {
        console.error('Required DOM elements not found.');
        return;
    }
    const duration = parseFloat(jsonData.format.duration);
    const frameRate = eval(jsonData.streams[0].r_frame_rate);
    const frameDuration = 1 / frameRate;
    const iFrames = jsonData.frames.filter(frame => frame.pict_type === 'I');
    const pFrames = jsonData.frames.filter(frame => frame.pict_type === 'P');
    const bFrames = jsonData.frames.filter(frame => frame.pict_type === 'B');
    const bitRate = jsonData.streams[0].bit_rate;
    const mbps = bitRate / (1024 * 1000);

    // --- UI Setup ---
    togglesDiv.innerHTML += `
        <button id="barView" class="view-switcher active">Bar View</button>
        <button id="lineView" class="view-switcher">Line View</button>
        <button id="resetZoom" class="view-switcher">Reset Zoom</button>
    `;
    togglesDiv.style.visibility = 'visible';

    // --- Plotly Traces and Layout ---
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
        xaxis: {
            title: 'Timestamp (seconds)',
            fixedrange: false
        },
        yaxis: {
            title: 'Frame Size (Mb)',
            gridcolor: '#444',
            fixedrange: true
        },
        plot_bgcolor: '#282828',
        paper_bgcolor: '#1e1e1e',
        font: { color: '#e0e0e0' },
        zoommode: 'x',
        dragmode: 'zoom',
        legend: {
            x: 0.05,
            y: 0.95,
            font: { color: '#e0e0e0' }
        },
        height: 400,
        autosize: true,
        margin: { l: 50, r: 50, t: 10, b: 20 },
        shapes: [
            {
                type: 'line',
                xref: 'paper',
                x0: 0,
                x1: 1,
                yref: 'y',
                y0: mbps,
                y1: mbps,
                line: { color: '#f200ff', width: 2, dash: 'dash' },
            }
        ],
        annotations: [
            {
                xref: 'paper',
                yref: 'y',
                x: 0,
                y: mbps,
                text: `Average Bitrate: ${mbps.toFixed(2)} Mb/s`,
                showarrow: false,
                font: { size: 12, color: '#f200ff' },
                bgcolor: '#282828',
                bordercolor: '#f200ff',
                borderwidth: 1,
                borderpad: 4,
                opacity: 0.8,
            }
        ]
    };

    // --- Plotly Chart Init ---
    Plotly.newPlot('frameChart', traces, layout, {
        displaylogo: false,
        annotations: true,
        responsive: true,
        useResizeHandler: true,
        modeBarButtonsToRemove: [
            'select2d', 'lasso2d', 'autoScale2d', 'toggleSpikelines',
            'zoom2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d', 'pan2d', 'zoomy'
        ],
        modeBarButtonsToAdd: [
            {
                name: 'Zoom X',
                icon: Plotly.Icons.zoom,
                click: function(gd) { Plotly.relayout(gd, {'dragmode': 'zoom'}); }
            }
        ]
    }).then(() => {
        const chartDiv = document.getElementById('frameChart');
        chartDiv.on('plotly_click', function(data) {
            if (data.points && data.points.length > 0) {
                const clickedTime = parseFloat(data.points[0].x);
                videoPlayer.currentTime = clickedTime;
            }
        });
    });

    // --- View Switch Buttons ---
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
    document.getElementById('resetZoom').addEventListener('click', function() {
        Plotly.relayout('frameChart', {
            'xaxis.autorange': true,
            'yaxis.autorange': true
        });
    });

    // --- Frame Type Visibility (if toggles are enabled) ---
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
    // --- Slider Setup ---
    slider.min = 0;
    slider.max = duration;
    slider.step = 0.01;
    slider.value = 0;
    sliderValue.textContent = '0.00s';
    slider.addEventListener('input', function() {
        const sliderTime = parseFloat(slider.value);
        videoPlayer.currentTime = sliderTime;
        sliderValue.textContent = sliderTime.toFixed(2) + 's';
        // Do NOT change the graph zoom here, just update the marker via timeupdate
    });

    // --- Video/Slider Sync and Marker Update ---
    videoPlayer.addEventListener('timeupdate', function() {
        const currentTime = videoPlayer.currentTime;
        syncSlider(currentTime);
        updateCurrentFrameMarker(currentTime);
    });
}