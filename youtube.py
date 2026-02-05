# Updated youtube.py
import sys
import os
import shutil
import json
import yt_dlp
import traceback
import subprocess
import tempfile
import time
import threading
import math

# Permanent download directory (per request)
DOWNLOAD_PATH = os.path.join(os.path.sep, "HASYIM56", "youtube")
os.makedirs(DOWNLOAD_PATH, exist_ok=True)

FFMPEG_PATH = shutil.which("ffmpeg")


def ffmpeg_available():
    return FFMPEG_PATH is not None


def build_format_selector(resolution):
    """
    resolution: int or None
    (video selector - unchanged behavior)
    """
    if resolution:
        return (
            f"bv*[ext=mp4][vcodec!=av1][height<={resolution}]+"
            "ba*[ext=m4a]/"
            f"bv*[ext=mp4][height<={resolution}]+"
            "ba*[ext=m4a]/"
            "best[ext=mp4]"
        )
    else:
        return (
            "bv*[ext=mp4][vcodec!=av1]+"
            "ba*[ext=m4a]+"
            "best[ext=mp4]"
        )


def build_audio_format_selector():
    """
    Audio selector for yt-dlp: prefer best audio in m4a/webm/mp4 etc.
    """
    return "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best"


def parse_resolution_arg(res_arg):
    """
    Accepts strings like '1080p', '720p', 'best', or numeric strings.
    Returns integer (height) or None for best.
    """
    if not res_arg:
        return None
    res_arg = str(res_arg).strip().lower()
    if res_arg in ("best", "max", "highest"):
        return None
    if res_arg.endswith("p"):
        res_arg = res_arg[:-1]
    try:
        val = int(res_arg)
        return val
    except:
        return None


def parse_audio_bitrate_arg(arg):
    """
    Accept bitrate-like strings for .ytmp3.
    Accepts values like '320k', '192', '192k', 'best'.
    Returns bitrate string for ffmpeg like '192k' or None for default.
    """
    if not arg:
        return None
    s = str(arg).strip().lower()
    if s in ("best", "max", "highest"):
        return None
    # if ends with k, ensure numeric portion
    if s.endswith("k"):
        try:
            int(s[:-1])
            return s
        except:
            return None
    # numeric only
    try:
        val = int(s)
        # typical bitrates are in kbps
        if val <= 0:
            return None
        return f"{val}k"
    except:
        return None


def safe_filename(name):
    # Basic sanitize for title -> filename
    # replace problematic chars with underscore
    return "".join(c if c.isalnum() or c in " ._()-" else "_" for c in name).strip()


# ---------------------------
# Progress reporting helpers
# ---------------------------
# All progress logs are written to stderr as structured JSON lines prefixed with "YT_PROGRESS:"
# This keeps stdout reserved for the final JSON output (unchanged behavior).
#
# The format (example):
# YT_PROGRESS:{"phase":"download","percent":12.3,"speed_kb_s":124.5,"downloaded":1234567,"total":9876543,"bar":"▰▰▰▱▱▱..."}
#
# These lines are additive only and do not alter any existing return values or file outputs.


def _make_progress_bar(percent, length=20):
    try:
        filled = int(round((percent / 100.0) * length))
        filled = max(0, min(length, filled))
        return "▰" * filled + "▱" * (length - filled)
    except Exception:
        return "▱" * length


def _safe_number(v):
    try:
        if v is None:
            return 0
        return float(v)
    except Exception:
        return 0.0


def emit_progress(phase, percent=None, downloaded=None, total=None, speed=None, message=None):
    """
    Emit a single-line JSON progress update to stderr with a fixed prefix.
    This function is defensive: it will not throw.
    Enhanced: always include speed_kb_s numeric (KB/s) field (0 if unknown) to help UI formatting.
    """
    try:
        obj = {"phase": phase}
        if percent is not None:
            p = float(percent)
            if math.isnan(p) or math.isinf(p):
                p = 0.0
            obj["percent"] = round(p, 2)
            obj["bar"] = _make_progress_bar(obj["percent"])
        if downloaded is not None:
            try:
                obj["downloaded"] = int(downloaded)
            except Exception:
                obj["downloaded"] = 0
        if total is not None:
            try:
                obj["total"] = int(total)
            except Exception:
                obj["total"] = 0

        # speed may be bytes/sec or None; convert safely to KB/s numeric
        try:
            if speed is None:
                speed_kb = 0.0
            else:
                speed_kb = float(speed) / 1024.0
                if math.isnan(speed_kb) or math.isinf(speed_kb):
                    speed_kb = 0.0
            obj["speed_kb_s"] = round(speed_kb, 2)
        except Exception:
            obj["speed_kb_s"] = 0.0

        if message:
            obj["message"] = str(message)

        # Write as a single line prefixed for easy downstream parsing without interfering with stdout JSON
        sys.stderr.write("YT_PROGRESS:" + json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stderr.flush()
    except Exception:
        try:
            # Best-effort, do not crash on progress logging
            sys.stderr.write("YT_PROGRESS:{\"phase\":\"error\",\"message\":\"progress logging failed\",\"speed_kb_s\":0}\n")
            sys.stderr.flush()
        except Exception:
            pass


def make_progress_hook():
    last_emit = {"t": 0}

    def progress_hook(d):
        """
        d: dict provided by yt-dlp progress hook.
        We throttle emits to at most 4 updates/sec (every 250ms) to avoid spamming.
        """
        try:
            status = d.get("status")
            # downloaded_bytes might be missing in some events
            downloaded = d.get("downloaded_bytes") or d.get("downloaded_bytes") or 0
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            # speed here is bytes/sec or None
            speed = d.get("speed") or 0
            percent = None
            if total and total > 0:
                try:
                    percent = (downloaded / total) * 100.0
                except Exception:
                    percent = d.get("percent") or None
            else:
                # sometimes yt-dlp provides 'eta' or 'percent' keys
                percent = d.get("percent") or None

            now = time.time()
            # throttle: emit at most every 250ms for responsiveness without excessive output
            if now - last_emit["t"] >= 0.25 or status == "finished":
                # emit, passing speed (bytes/sec) and percent (numeric)
                emit_progress("download", percent=percent, downloaded=downloaded, total=total, speed=speed, message=status)
                last_emit["t"] = now
        except Exception:
            # swallow any hook errors to not affect download process
            pass

    return progress_hook


# ---------------------------
# FFmpeg transcode monitoring
# ---------------------------
def monitor_transcode_progress(output_path, reference_size_getter, stop_event, poll_interval=0.5):
    """
    Monitor the transcode output file size and emit approximate progress.
    """
    try:
        last_size = 0
        last_time = time.time()
        last_emit_t = 0
        while not stop_event.is_set():
            try:
                if os.path.exists(output_path):
                    cur_size = os.path.getsize(output_path)
                else:
                    cur_size = 0
                ref_size = reference_size_getter() or 1
                percent = min(99.9, (cur_size / float(ref_size)) * 100.0) if ref_size > 0 else 0.0

                # speed estimate (KB/s) based on growth
                now = time.time()
                delta_t = now - last_time if now - last_time > 0 else 1.0
                delta_b = cur_size - last_size
                speed_b_s = delta_b / delta_t if delta_t > 0 else 0.0

                # throttle emits to approx 2/sec to be kind
                if now - last_emit_t >= 0.5:
                    emit_progress("transcode", percent=percent, downloaded=cur_size, total=ref_size, speed=speed_b_s, message="transcoding")
                    last_emit_t = now

                last_size = cur_size
                last_time = now
            except Exception:
                # safe guard: ignore per-iteration errors
                pass

            # sleep in small increments, exit quickly when stop_event set
            stop_event.wait(poll_interval)
    except Exception:
        # never throw from monitor
        pass


def run_ffmpeg_transcode(input_path, output_path):
    """
    Transcode video using ffmpeg to H.264 + AAC (unchanged).
    """
    if not ffmpeg_available():
        raise RuntimeError("FFmpeg wajib terpasang agar file tidak rusak")

    args = [
        FFMPEG_PATH,
        "-y",
        "-i",
        input_path,
        # video codec
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "23",
        # pixel format for maximum compatibility (no black frames)
        "-pix_fmt",
        "yuv420p",
        # audio codec
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ac",
        "2",
        "-ar",
        "44100",
        # ensure faststart for streaming / playback on mobile platforms
        "-movflags",
        "+faststart",
        output_path,
    ]

    # Prepare monitor thread that observes output_path growth.
    stop_event = threading.Event()

    def reference_size():
        try:
            return os.path.getsize(input_path) if os.path.exists(input_path) else 1
        except Exception:
            return 1

    monitor_thread = threading.Thread(target=monitor_transcode_progress, args=(output_path, reference_size, stop_event), daemon=True)
    monitor_thread.start()

    proc = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stop_event.set()
    try:
        monitor_thread.join(timeout=2.0)
    except Exception:
        pass

    if proc.returncode != 0:
        stderr = proc.stderr.decode(errors="ignore")
        raise RuntimeError(f"ffmpeg transcode failed: {stderr.splitlines()[-10:]}")


def run_ffmpeg_audio_transcode(input_path, output_path, bitrate="192k"):
    """
    Transcode audio using ffmpeg to MP3 with given bitrate.
    Attach monitor thread to emit 'transcode' progress.
    """
    if not ffmpeg_available():
        raise RuntimeError("FFmpeg wajib terpasang agar file tidak rusak")

    args = [
        FFMPEG_PATH,
        "-y",
        "-i",
        input_path,
        "-vn",
        "-c:a",
        "libmp3lame",
        "-b:a",
        bitrate,
        output_path,
    ]

    stop_event = threading.Event()

    def reference_size():
        try:
            return os.path.getsize(input_path) if os.path.exists(input_path) else 1
        except Exception:
            return 1

    monitor_thread = threading.Thread(target=monitor_transcode_progress, args=(output_path, reference_size, stop_event), daemon=True)
    monitor_thread.start()

    proc = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stop_event.set()
    try:
        monitor_thread.join(timeout=2.0)
    except Exception:
        pass

    if proc.returncode != 0:
        stderr = proc.stderr.decode(errors="ignore")
        raise RuntimeError(f"ffmpeg audio transcode failed: {stderr.splitlines()[-10:]}")


def download_youtube_video(url, resolution, mode="mp4", audio_bitrate=None):
    """
    Downloads video/audio using yt_dlp to DOWNLOAD_PATH, then transcodes to compatible MP4 or MP3.
    mode: "mp4" (default) or "mp3"
    audio_bitrate: string like '192k' (used only when mode == "mp3")
    Returns path to final file (absolute), filesize bytes and title.
    Raises RuntimeError on failure.
    """
    # Require ffmpeg for final transcode/compatibility
    if not ffmpeg_available():
        raise RuntimeError("FFmpeg wajib terpasang agar file tidak rusak")

    if mode == "mp3":
        format_selector = build_audio_format_selector()
    else:
        res_int = parse_resolution_arg(resolution)
        format_selector = build_format_selector(res_int)

    # Use a temporary outtmpl using id to avoid invalid filename characters during download,
    # we'll rename/transcode to sanitized title afterwards.
    tmp_outtmpl = os.path.join(DOWNLOAD_PATH, "%(id)s.%(ext)s")

    # Attach our progress hook in addition to existing options; this is additive only.
    ydl_opts = {
        "format": format_selector,
        "outtmpl": tmp_outtmpl,
        "merge_output_format": "mp4" if mode != "mp3" else None,
        "ffmpeg_location": FFMPEG_PATH,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "retries": 3,
        "progress_hooks": [make_progress_hook()],
    }

    # For audio only downloads, avoid merge_output_format override
    if mode == "mp3" and "merge_output_format" in ydl_opts:
        ydl_opts.pop("merge_output_format", None)

    downloaded_path = None
    info_dict = None

    try:
        # Emit initial "starting" progress to stderr (non-blocking, additive)
        emit_progress("download", percent=0.0, downloaded=0, total=0, speed=0, message="starting")

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(url, download=True)
            # yt_dlp may return info or a playlist dict; handle common cases
            # If video was downloaded, yt_dlp should populate _filename in info_dict
            if isinstance(info_dict, dict):
                # for some versions, _filename present
                filename = info_dict.get("_filename")
                if filename and os.path.exists(filename):
                    downloaded_path = filename

        # Fallback: find most recent file in DOWNLOAD_PATH if _filename missing
        if not downloaded_path:
            candidates = []
            for root, _, files in os.walk(DOWNLOAD_PATH):
                for f in files:
                    candidates.append(os.path.join(root, f))
            if not candidates:
                raise RuntimeError("Gagal menemukan file hasil download setelah yt-dlp selesai.")
            candidates.sort(key=lambda p: os.path.getmtime(p), reverse=True)
            downloaded_path = candidates[0]

        # Prepare final filename based on title if available
        title = None
        if info_dict and isinstance(info_dict, dict):
            title = info_dict.get("title") or info_dict.get("id")
        if not title:
            title = os.path.splitext(os.path.basename(downloaded_path))[0]

        safe_title = safe_filename(title)
        if mode == "mp3":
            final_file = os.path.join(DOWNLOAD_PATH, f"{safe_title}.mp3")
        else:
            final_file = os.path.join(DOWNLOAD_PATH, f"{safe_title}.mp4")

        # Always transcode to ensure compatibility
        # If downloaded_path already equals final file, transcode to a temp file first to avoid clobbering.
        with tempfile.NamedTemporaryFile(prefix="ytdl_transcode_", suffix=os.path.splitext(final_file)[1], dir=DOWNLOAD_PATH, delete=False) as tf:
            transcode_tmp = tf.name

        try:
            # Emit a "transcode starting" message (additive)
            emit_progress("transcode", percent=0.0, downloaded=0, total=os.path.getsize(downloaded_path) if os.path.exists(downloaded_path) else 0, speed=0, message="starting")

            if mode == "mp3":
                # Decide bitrate default
                bitrate = audio_bitrate or "192k"
                run_ffmpeg_audio_transcode(downloaded_path, transcode_tmp, bitrate=bitrate)
            else:
                run_ffmpeg_transcode(downloaded_path, transcode_tmp)

            # move transcode_tmp to final_file (overwrite if exists)
            if os.path.exists(final_file):
                try:
                    os.remove(final_file)
                except Exception:
                    pass
            os.replace(transcode_tmp, final_file)
            # Final transcode completion emit (100%)
            emit_progress("transcode", percent=100.0, downloaded=os.path.getsize(final_file), total=os.path.getsize(downloaded_path) if os.path.exists(downloaded_path) else os.path.getsize(final_file), speed=0, message="finished")
        except Exception as e:
            # cleanup tmp if exists
            try:
                if os.path.exists(transcode_tmp):
                    os.remove(transcode_tmp)
            except:
                pass
            raise

        # Remove the original downloaded file if different from final_file
        try:
            if os.path.abspath(downloaded_path) != os.path.abspath(final_file) and os.path.exists(downloaded_path):
                os.remove(downloaded_path)
        except Exception:
            pass

        filesize = os.path.getsize(final_file)
        # Emit a final download-complete progress (100%)
        emit_progress("download", percent=100.0, downloaded=filesize, total=filesize, speed=0, message="finished")
        return os.path.abspath(final_file), filesize, title
    except Exception as e:
        # bubble up with traceback for clarity
        # also emit an error progress line for downstream UX consumers
        try:
            emit_progress("error", percent=0.0, downloaded=0, total=0, speed=0, message=str(e))
        except Exception:
            pass
        raise RuntimeError(f"Download or transcode failed: {str(e)}\n{traceback.format_exc()}")


def main():
    """
    Usage:
      youtube.py <url> <resolution_or_bitrate> <mode>
    Examples:
      youtube.py "https://youtube.com/..." 720p        -> download mp4 (default)
      youtube.py "https://youtube.com/..." best mp4    -> same as default
      youtube.py "https://youtube.com/..." 192k mp3    -> download audio and transcode to 192 kbps mp3
      youtube.py "https://youtube.com/..." mp3         -> download audio and transcode to default bitrate (192k)
    """
    if len(sys.argv) < 2:
        print("Usage: youtube.py <url> <resolution_or_bitrate> <mode>", file=sys.stderr)
        sys.exit(2)

    url = sys.argv[1]
    arg2 = sys.argv[2] if len(sys.argv) >= 3 else None
    arg3 = sys.argv[3] if len(sys.argv) >= 4 else None

    # Determine mode: if arg3 == 'mp3' or arg2 == 'mp3'
    mode = "mp4"
    bitrate = None
    if arg3 and str(arg3).lower() == "mp3":
        mode = "mp3"
        bitrate = parse_audio_bitrate_arg(arg2) or None
    elif arg2 and str(arg2).lower() == "mp3":
        mode = "mp3"
        bitrate = None
    else:
        # If mode not explicitly requested but arg2 looks like a bitrate (e.g., '192k' or '320'), treat as mp3 request when arg2 endswith 'k' or numeric and user intended mp3.
        # However, default behavior should remain mp4 unless 'mp3' provided.
        mode = "mp4"
        bitrate = None

    # If user explicitly passed 'mp3' as third param earlier handled; otherwise resolution is arg2 for mp4
    resolution_or_bitrate = arg2 if arg2 else None

    try:
        if mode == "mp3":
            file_path, filesize, title = download_youtube_video(url, resolution_or_bitrate, mode="mp3", audio_bitrate=bitrate)
        else:
            file_path, filesize, title = download_youtube_video(url, resolution_or_bitrate, mode="mp4")
        out = {"file": file_path, "filesize": filesize, "title": title}
        # Print single-line JSON to stdout
        print(json.dumps(out))
        sys.exit(0)
    except Exception as e:
        # Print error and traceback to stderr for diagnostics
        tb = traceback.format_exc()
        print(str(e), file=sys.stderr)
        print(tb, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()