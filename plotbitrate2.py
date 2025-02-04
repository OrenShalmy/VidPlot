import matplotlib.pyplot as plt
import mplcyberpunk
import subprocess
from datetime import timedelta
from typing import List, Tuple, Dict
import json
import os
import argparse

ffprobe = "ffprobe"


def extract_bitrate_and_frames(video_file: str, output_json: str = None) -> Tuple[float, List[Tuple[float, float]], Dict[str, List[float]]]:
    ffprobe_cmd = [
        ffprobe, "-hide_banner", "-loglevel", "error",
        "-select_streams", "v",
        "-threads", "8",
        "-print_format", "json",
        "-show_entries", "frame=pict_type,best_effort_timestamp_time,pkt_size",
        "-show_entries", "stream=r_frame_rate",
        video_file
    ]

    result = subprocess.run(ffprobe_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    logs_dir = os.path.join(os.path.dirname(video_file), 'logs')  # logs dir relative to video
    os.makedirs(logs_dir, exist_ok=True)

    if not output_json:
        base_name = os.path.splitext(os.path.basename(video_file))[0]
        output_json = os.path.join(logs_dir, f"{base_name}_bitrate_data.json")

    data = json.loads(result.stdout)
    with open(output_json, "w") as json_file:
        json.dump(data, json_file, indent=4)
    print(f"Data saved to {output_json}")

    frame_rate_str = data.get("streams", [{}])[0].get("r_frame_rate", "0/1")
    num, denom = map(int, frame_rate_str.split('/'))
    frame_rate = num / denom

    bitrates = []
    frame_types = {"I": [], "P": [], "B": []}

    for frame in data.get("frames", []):
        pict_type = frame.get("pict_type")
        time_str = frame.get("best_effort_timestamp_time")
        size_str = frame.get("pkt_size")

        if time_str and size_str:
            try:
                time = float(time_str)
                size = int(size_str)
                bitrate = ((size * 8) * frame_rate) / 1000
                bitrates.append((time, bitrate))
                if pict_type in frame_types:
                    frame_types[pict_type].append(time)
            except ValueError as e:
                print(f"Skipping frame due to error: {e}")

    return frame_rate, bitrates, frame_types

def calculate_gop_bitrates(bitrates: List[Tuple[float, float]], i_frame_times: List[float]) -> List[Tuple[float, float]]:
    gop_bitrates = []
    num_i_frames = len(i_frame_times)

    for i in range(num_i_frames - 1):
        gop_start = i_frame_times[i]
        gop_end = i_frame_times[i + 1]
        gop_bitrate_values = [bitrate[1] for bitrate in bitrates if gop_start <= bitrate[0] < gop_end]

        if gop_bitrate_values:
            avg_gop_bitrate = sum(gop_bitrate_values) / len(gop_bitrate_values)
            gop_midpoint = (gop_start + gop_end) / 2
            gop_bitrates.append((gop_midpoint, avg_gop_bitrate))

    return gop_bitrates

def calculate_sliding_window_bitrate(bitrates: List[Tuple[float, float]], window_size: int) -> List[Tuple[float, float]]:
    num_frames = len(bitrates)
    sliding_averages = []

    for i in range(num_frames - window_size + 1):
        window_time = bitrates[i + window_size // 2][0]
        window_bitrate = sum(bitrate[1] for bitrate in bitrates[i:i + window_size]) / window_size
        sliding_averages.append((window_time, window_bitrate))

    return sliding_averages

def plot_data(video_file: str, output_json: str = None, save_plot: str = None):
    # Unpack frame rate, bitrates, and frame types
    frame_rate, bitrates, frame_types = extract_bitrate_and_frames(video_file, output_json)

    if not bitrates:
        print("No bitrate found in file.")
        return

    window_size = int(frame_rate * 2)  # 2-second sliding window

    original_times = [point[0] for point in bitrates]
    original_values = [point[1] for point in bitrates]
    sliding_averages = calculate_sliding_window_bitrate(bitrates, window_size)
    sliding_times = [point[0] for point in sliding_averages]
    sliding_values = [point[1] for point in sliding_averages]
    overall_avg_bitrate = sum(original_values) / len(original_values)
    gop_bitrates = calculate_gop_bitrates(bitrates, frame_types.get("I", []))

    plt.style.use("cyberpunk")
    plt.figure(figsize=[25, 8])
    plt.title(f"Bitrate Plot with Frame Types for {os.path.basename(video_file)}", fontsize=16)
    plt.xlabel("Time (HH:MM:SS)", fontsize=12)
    plt.ylabel("Bitrate (kbps)", fontsize=12)
    plt.grid(True, axis="y", linestyle="--", alpha=0.5)

    # Plot overall average bitrate
    plt.axhline(overall_avg_bitrate, color="yellow", linestyle="-.", linewidth=0.5, label=f"Overall Avg Bitrate: {overall_avg_bitrate:.2f} kbps")

    # Plot original per-frame bitrate
    plt.plot(original_times, original_values, label="Original Bitrate", color="grey", linewidth=0.5, alpha=0.7)

    # Plot sliding window averages
    # plt.plot(sliding_times, sliding_values, label="Sliding Window Average (2s)", color="magenta", linewidth=0.5, alpha=1)

    # Plot GOP average bitrates
    for gop_time, gop_bitrate in gop_bitrates:
        plt.scatter([gop_time], [gop_bitrate], color="orange", label="GOP Avg Bitrate" if gop_time == gop_bitrates[0][0] else "", marker="x", s=20, zorder=5)
        plt.text(gop_time, gop_bitrate + 200, f"{gop_bitrate:.2f} \nkbps", color="orange", fontsize=5, ha="center")

    # Add frame type indicators below the plot
    for frame_type, times in frame_types.items():
        if frame_type == "I":
            plt.scatter(times, [-50] * len(times), color="red", label="I-frames", marker="o", s=15, zorder=5)
        elif frame_type == "P":
            plt.scatter(times, [-100] * len(times), color="blue", label="P-frames", marker="o", s=15, zorder=5)
        elif frame_type == "B":
            plt.scatter(times, [-150] * len(times), color="green", label="B-frames", marker="o", s=15, zorder=5)

    # Format x-axis with timecodes
    plt.gca().xaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: str(timedelta(seconds=int(x)))))
    plt.legend(loc="upper right")
    mplcyberpunk.add_underglow()
    plt.tight_layout()

    if not save_plot:
        base_name = os.path.splitext(os.path.basename(video_file))[0]
        logs_dir = os.path.join(os.path.dirname(video_file), 'logs')  # logs dir relative to video
        save_plot = os.path.join(logs_dir, f"{base_name}_bitrate_plot.png")

    plt.savefig(save_plot, dpi=300)
    plt.close()
    print(f"Plot saved to {save_plot}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Plot video bitrate with frame types for multiple files.")
    parser.add_argument("input_path", help="Path to the video file or directory containing video files.")
    args = parser.parse_args()

    if os.path.isdir(args.input_path):
        for filename in os.listdir(args.input_path):
            if filename.lower().endswith(('.mp4')):  # Add more video extensions if needed
                video_file = os.path.join(args.input_path, filename)
                plot_data(video_file) # output_plot is now handled within plot_data
    else:
        plot_data(args.input_path)