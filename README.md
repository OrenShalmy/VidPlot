# VidPlot2

A web-based video frame analyzer that provides visual insights into video frame types and bitrates.

## Prerequisites

1. Python 3.7 or higher
2. FFmpeg with ffprobe (for video analysis)

## Installation

### 1. Install FFmpeg

#### On macOS:
```bash
brew install ffmpeg
```

#### On Ubuntu/Debian:
```bash
sudo apt update
sudo apt install ffmpeg
```

#### On Windows:
Download from [FFmpeg website](https://ffmpeg.org/download.html) and add to system PATH

### 2. Setup Python Environment

```bash
# Clone the repository
git clone [your-repo-url]
cd VidPlot2

# Create and activate virtual environment (optional but recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Running the Application

1. Start the server:
```bash
python app.py
```

2. Open your web browser and navigate to:
```
http://localhost:5000
```

## Usage

1. Drag and drop a video file onto the upload area or click to select a file
2. Wait for the analysis to complete
3. View the frame analysis and video information
plots data-rate and frame type
