import yt_dlp
import sys
import json
import os
import argparse
from datetime import datetime

def human_file(path):
    try:
        return os.path.abspath(path)
    except:
        return path

def download_tiktok(url, resolution="720p", output_template="%(title)s.%(ext)s"):
    height_map = {
        "144p": 144,
        "240p": 240,
        "480p": 480,
        "720p": 720,
        "1080p": 1080,
        "best": None,
    }

    if resolution not in height_map:
        raise ValueError("Resolusi tidak valid")

    max_height = height_map.get(resolution, None)

    # progress hook: print JSON lines to stderr prefixed with TT_PROGRESS:
    def progress_hook(d):
        try:
            status = d.get("status")
            if status == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                downloaded = d.get("downloaded_bytes") or 0
                speed = d.get("speed") or 0  # bytes/sec
                percent = 0.0
                if total and total > 0:
                    percent = (downloaded / total) * 100.0
                payload = {
                    "phase": "download",
                    "status": "downloading",
                    "percent": round(percent, 2),
                    "speed_kb_s": round((speed / 1024.0) if speed else 0, 2),
                    "downloaded_bytes": downloaded,
                    "total_bytes": total
                }
                sys.stderr.write("TT_PROGRESS:" + json.dumps(payload) + "\n")
                sys.stderr.flush()
            elif status == "finished":
                payload = {"phase": "download", "status": "finished"}
                sys.stderr.write("TT_PROGRESS:" + json.dumps(payload) + "\n")
                sys.stderr.flush()
        except Exception:
            # avoid crashing the hook
            pass

    if resolution == "best" or max_height is None:
        fmt = "bestvideo+bestaudio/best"
    else:
        # try to prefer video stream with height <= max_height then merge with audio
        fmt = f"bv*[height<={max_height}]+ba/best"

    ydl_opts = {
        "outtmpl": output_template,
        "merge_output_format": "mp4",
        "format": fmt,
        "progress_hooks": [progress_hook],
        "quiet": True,
        "no_warnings": True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        # prepare filename (final file)
        try:
            filename = ydl.prepare_filename(info)
            # ydl may output different extension after merging; ensure .mp4 when merge_output_format=mp4
            if not filename.lower().endswith(".mp4"):
                base = os.path.splitext(filename)[0]
                filename = base + ".mp4"
        except Exception:
            # fallback: attempt to find in info
            filename = info.get("_filename") or info.get("requested_downloads", [{}])[0].get("filepath") or None

        if not filename or not os.path.exists(filename):
            # try searching for any file in cwd that was recently modified and likely the file
            possible = []
            for root, _, files in os.walk(".", topdown=True):
                for f in files:
                    if f.lower().endswith((".mp4", ".mkv", ".webm", ".mov")):
                        p = os.path.join(root, f)
                        possible.append((os.path.getmtime(p), p))
            if possible:
                possible.sort(reverse=True)
                filename = possible[0][1]

        if not filename:
            raise RuntimeError("Tidak dapat menentukan path output hasil download")

        abs_path = os.path.abspath(filename)
        filesize = os.path.getsize(abs_path)
        title = info.get("title") or os.path.splitext(os.path.basename(filename))[0]

        # Output final JSON to stdout for index.js to parse
        out = {"file": abs_path, "filesize": filesize, "title": title}
        sys.stdout.write(json.dumps(out))
        sys.stdout.flush()
        return out

def main():
    parser = argparse.ArgumentParser(prog="tiktok.py", description="Download TikTok video using yt_dlp and emit JSON result.")
    parser.add_argument("url", help="TikTok URL to download")
    parser.add_argument("--resolution", "-r", default="720p", help="Resolution (144p/240p/480p/720p/1080p/best). Default 720p")
    parser.add_argument("--output", "-o", default="%(title)s.%(ext)s", help="Output template for yt_dlp (optional).")
    args = parser.parse_args()

    try:
        result = download_tiktok(args.url, resolution=args.resolution, output_template=args.output)
        # already printed in download_tiktok
    except Exception as e:
        err = {"error": True, "message": str(e)}
        # print error JSON to stderr so caller can detect
        sys.stderr.write(json.dumps(err) + "\n")
        sys.stderr.flush()
        sys.exit(2)

if __name__ == "__main__":
    main()