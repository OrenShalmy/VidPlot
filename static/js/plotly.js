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
    function findFrameIndexByTime(time, frames) {
        let closestIdx = 0;
        let minDiff = Infinity;
        frames.forEach((frame, idx) => {
            const timestamp = parseFloat(frame.best_effort_timestamp_time);
            const diff = Math.abs(time - timestamp);
            if (diff < minDiff) {
                minDiff = diff;
                closestIdx = idx;
            }
        });
        return closestIdx;
    }
    function updateCurrentFrameMarker(currentTime) {
        // Snap to the closest frame timestamp
        const closestFrame = findClosestFrame(currentTime, jsonData.frames);
        const snappedTime = closestFrame ? parseFloat(closestFrame.best_effort_timestamp_time) : currentTime;
        // Remove previous marker if exists
        let updateShapes = layout.shapes.filter(s => s.name !== currentFrameShapeId);
        // Add new marker
        updateShapes.push({
            type: 'line',
            xref: 'x',
            x0: snappedTime,
            x1: snappedTime,
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

    // --- Variable Setup ---
    let currentView = 'bar';
    const currentFrameShapeId = 'current-frame-marker';
    const togglesDiv = document.querySelector('div.toggles');
    const videoPlayer = document.getElementById('videoPlayer');
    if (!togglesDiv || !videoPlayer) {
        console.error('Required DOM elements not found.');
        return;
    }
    const duration = parseFloat(jsonData.format.duration);
    const iFrames = jsonData.frames.filter(frame => frame.pict_type === 'I');
    const pFrames = jsonData.frames.filter(frame => frame.pict_type === 'P');
    const bFrames = jsonData.frames.filter(frame => frame.pict_type === 'B');
    const allFrames = jsonData.frames.map(f => ({
        ...f,
        timestamp: parseFloat(f.best_effort_timestamp_time),
        pktSize: parseInt(f.pkt_size)
    }));
    const frameTimestamps = allFrames.map(f => f.timestamp);
    const frameDuration = allFrames.length > 1 ? (frameTimestamps[1] - frameTimestamps[0]) : 1 / 30;
    const bitRate = jsonData.streams[0].bit_rate;
    const mbps = bitRate / (1024 * 1000);

    // --- UI Setup ---
    togglesDiv.innerHTML = `
        <button id="barView" class="view-switcher active">Bar View</button>
        <button id="lineView" class="view-switcher">Line View</button>
        <button id="resetZoom" class="view-switcher">Reset Zoom</button>
    `;
    togglesDiv.style.visibility = 'visible';

    // --- Plotly Traces and Layout ---
    function createTraces(type) {
        if (type === 'bar') {
            // Plot all frames as a single bar trace, color by frame type
            const colors = jsonData.frames.map(f => {
                if (f.pict_type === 'I') return '#0161ff';
                if (f.pict_type === 'P') return '#70a6ff';
                if (f.pict_type === 'B') return '#ffffff';
                return '#888888';
            });
            return [
                {
                    x: jsonData.frames.map(f => parseFloat(f.best_effort_timestamp_time)),
                    y: jsonData.frames.map(f => bytesToMbps(parseInt(f.pkt_size), frameDuration)),
                    type: 'bar',
                    name: 'Frames',
                    marker: { color: colors },
                    hovertemplate: "Timestamp: %{x:.4f} s<br>Size: %{y:.2f} Mb<br>Type: %{customdata}",
                    customdata: jsonData.frames.map(f => f.pict_type)
                }
            ];
        } else {
            const allSorted = [...jsonData.frames].sort((a, b) => 
                parseFloat(a.best_effort_timestamp_time) - parseFloat(b.best_effort_timestamp_time)
            );
            return [{
                x: allSorted.map(f => parseFloat(f.best_effort_timestamp_time)),
                y: allSorted.map(f => bytesToMbps(parseInt(f.pkt_size), frameDuration)),
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

    // --- Video/Marker Sync ---
    videoPlayer.addEventListener('timeupdate', function() {
        const currentTime = videoPlayer.currentTime;
        updateCurrentFrameMarker(currentTime);
    });

    // --- Keyboard Frame Navigation & Zoom ---
    document.addEventListener('keydown', function(e) {
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
        let skipToIdx = null;
        const currentIdx = findFrameIndexByTime(videoPlayer.currentTime, jsonData.frames);
        if (e.key === 'ArrowRight') {
            if (currentIdx < jsonData.frames.length - 1) {
                skipToIdx = currentIdx + 1;
                e.preventDefault();
            }
        } else if (e.key === 'ArrowLeft') {
            if (currentIdx > 0) {
                skipToIdx = currentIdx - 1;
                e.preventDefault();
            }
        } else if (e.key === '+' || e.key === '=' ) {
            // Zoom in (halve the x-axis range)
            const xaxis = layout.xaxis;
            let [xmin, xmax] = [xaxis.range ? xaxis.range[0] : 0, xaxis.range ? xaxis.range[1] : duration];
            if (!xaxis.range) {
                xmin = 0;
                xmax = duration;
            }
            const center = (xmin + xmax) / 2;
            const halfRange = (xmax - xmin) / 4;
            Plotly.relayout('frameChart', {'xaxis.range': [center - halfRange, center + halfRange]});
            e.preventDefault();
        } else if (e.key === '-') {
            // Zoom out (double the x-axis range)
            const xaxis = layout.xaxis;
            let [xmin, xmax] = [xaxis.range ? xaxis.range[0] : 0, xaxis.range ? xaxis.range[1] : duration];
            if (!xaxis.range) {
                xmin = 0;
                xmax = duration;
            }
            const center = (xmin + xmax) / 2;
            let newMin = Math.max(0, center - (xmax - xmin));
            let newMax = Math.min(duration, center + (xmax - xmin));
            Plotly.relayout('frameChart', {'xaxis.range': [newMin, newMax]});
            e.preventDefault();
        }
        if (skipToIdx !== null) {
            const targetFrame = jsonData.frames[skipToIdx];
            const targetTime = parseFloat(targetFrame.best_effort_timestamp_time);
            videoPlayer.pause();
            // Only update marker after seeked
            const onSeeked = function() {
                updateCurrentFrameMarker(targetTime);
                videoPlayer.removeEventListener('seeked', onSeeked);
            };
            videoPlayer.addEventListener('seeked', onSeeked);
            videoPlayer.currentTime = targetTime;
        }
    });
}