import os
import subprocess
from flask import Flask, request, jsonify, send_from_directory, render_template, redirect, url_for
from werkzeug.utils import secure_filename

app = Flask(__name__)

UPLOAD_FOLDER = os.path.join(app.root_path, 'uploads')
OUTPUT_FOLDER = os.path.join(app.root_path, 'static', 'media', 'logs')
ALLOWED_EXTENSIONS = {'mp4', 'mov'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['OUTPUT_FOLDER'] = OUTPUT_FOLDER

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_video():
    if 'video' not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files['video']

    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        public_upload_folder = os.path.join(app.root_path, 'static', 'media', 'uploads')
        os.makedirs(public_upload_folder, exist_ok=True)
        public_filepath = os.path.join(public_upload_folder, filename)
        file.save(public_filepath)
        
        json_filename = f"{os.path.splitext(filename)[0]}_data.json"
        output_json_path = os.path.join(app.config['OUTPUT_FOLDER'], json_filename)
        
        ffprobe_cmd = (
            f'ffprobe -hide_banner -loglevel error '
            f'-select_streams v -threads 4 -print_format json '
            f'-show_entries "frame=pict_type,best_effort_timestamp_time,pkt_size" '
            f'-show_entries stream=r_frame_rate,bit_rate "{public_filepath}" > "{output_json_path}"'
        )
        
        try:
            subprocess.run(ffprobe_cmd, shell=True, check=True)
        except subprocess.CalledProcessError as e:
            os.remove(public_filepath)
            return jsonify({"error": "Error processing video", "details": str(e)}), 500

        video_url = url_for('static', filename=f'media/uploads/{filename}')
        json_url = url_for('static', filename=f'media/logs/{json_filename}')
        return jsonify({"message": "File processed successfully", "json_url": json_url, "video_url": video_url})
    else:
        return jsonify({"error": "Invalid file type"}), 400

if __name__ == '__main__':
    app.run(debug=True)
