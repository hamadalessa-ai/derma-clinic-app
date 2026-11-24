"""Sound for the pitch video: two versions of pitch/out/derma-pitch.mp4.

  derma-pitch-music.mp4  the composed music only (scripts/pitch/music.m4a)
  derma-pitch-voice.mp4  an Arabic voiceover (scripts/pitch/voiceover.json, one line per scene)
                         over the music, turned down under the voice. The lines recorded with
                         ElevenLabs (voice/line-N.mp3, Saudi voice "Afnan – Natural & Expressive") are used when present,
                         else Piper's Arabic voice reads them.

Each line starts 0.4 s into its scene and is sped up a little (at most 1.18x) if it would run
past the scene. The video picture is copied, never encoded again.
"""
import json, subprocess, sys, wave
from pathlib import Path

OUT = Path("pitch/out")
VIDEO = OUT / "derma-pitch.mp4"
MUSIC = Path("scripts/pitch/music.m4a")
MODEL = sys.argv[1] if len(sys.argv) > 1 else "voice/ar_JO-kareem-medium.onnx"
durs = json.loads((OUT / "scenes.json").read_text())
lines = json.loads(Path("scripts/pitch/voiceover.json").read_text())
total = sum(durs)
tmp = OUT / "voice"
tmp.mkdir(parents=True, exist_ok=True)


def run(*args):
    subprocess.run(args, check=True)


def length(path):
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


# Music only.
run("ffmpeg", "-y", "-loglevel", "error", "-i", str(VIDEO), "-i", str(MUSIC),
    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
    "-af", f"afade=t=out:st={total - 2.5}:d=2.5", "-t", str(total),
    "-movflags", "+faststart", str(OUT / "derma-pitch-music.mp4"))

# One continuous take (voice/full.mp3, all scenes read in one go — more natural than separate
# lines): split it into one piece per scene at its longest pauses.
full = Path("voice/full.mp3")
if full.exists():
    whole = tmp / "full.wav"
    run("ffmpeg", "-y", "-loglevel", "error", "-i", str(full), "-ar", "44100", "-ac", "1", str(whole))
    pieces = len([x for x in lines if x]) - 1
    # Find the pauses between lines; a take with short pauses needs a looser setting.
    for noise, d in [(-38, 0.35), (-38, 0.25), (-35, 0.25), (-35, 0.18), (-32, 0.18), (-30, 0.14), (-28, 0.12)]:
        det = subprocess.run(["ffmpeg", "-i", str(whole), "-af", f"silencedetect=noise={noise}dB:d={d}",
                              "-f", "null", "-"], capture_output=True, text=True).stderr
        starts = [float(x.split("silence_start: ")[1].split()[0]) for x in det.splitlines() if "silence_start" in x]
        ends = [float(x.split("silence_end: ")[1].split()[0]) for x in det.splitlines() if "silence_end" in x]
        gaps = sorted(zip(starts, ends), key=lambda g: g[1] - g[0], reverse=True)
        print(f"pauses at {noise} dB / {d} s:", len(gaps))
        if len(gaps) >= pieces:
            break
    cuts = sorted((a + b) / 2 for a, b in gaps[:pieces])
    print("cuts at", [round(c, 2) for c in cuts], "pause lengths", [round(b - a, 2) for a, b in gaps[:pieces]])
    bounds = [0.0] + cuts + [length(whole)]
    k = 0
    for i, text in enumerate(lines):
        if not text:
            continue
        seg = tmp / f"seg-{i}.wav"
        run("ffmpeg", "-y", "-loglevel", "error", "-i", str(whole), "-ss", f"{bounds[k]:.3f}",
            "-to", f"{bounds[k + 1]:.3f}", str(seg))
        Path(f"voice/line-{i}.mp3").unlink(missing_ok=True)
        run("ffmpeg", "-y", "-loglevel", "error", "-i", str(seg), str(Path(f"voice/line-{i}.mp3")))
        k += 1

# Voice lines, placed at their scenes.
inputs, filters, start = [], [], 0.0
for i, (dur, text) in enumerate(zip(durs, lines)):
    if text:
        raw = tmp / f"line-{i}.wav"
        recorded = Path(f"voice/line-{i}.mp3")
        if recorded.exists():
            # Trim the silence at both ends of the recording.
            run("ffmpeg", "-y", "-loglevel", "error", "-i", str(recorded), "-af",
                "silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
                "silenceremove=start_periods=1:start_threshold=-45dB,areverse",
                "-ar", "44100", str(raw))
        else:
            subprocess.run(["piper", "-m", MODEL, "-f", str(raw), "--sentence_silence", "0.25"],
                           input=text.encode(), check=True)
        room = dur - 0.6
        speed = min(1.12, max(1.0, length(raw) / room))
        print(f"scene {i}: {length(raw):.1f}s of speech in {dur}s (speed {speed:.2f})")
        inputs += ["-i", str(raw)]
        n = len(inputs) // 2 - 1
        delay = int((start + 0.4) * 1000)
        filters.append(f"[{n}:a]atempo={speed:.3f},aresample=44100,adelay={delay}|{delay}[v{n}]")
    start += dur
n = len(inputs) // 2
mix = "".join(f"[v{i}]" for i in range(n))
filters.append(f"{mix}amix=inputs={n}:normalize=0,volume=1.6,apad=whole_dur={total}[voice]")
run("ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(filters),
    "-map", "[voice]", "-t", str(total), "-ac", "2", str(tmp / "voice.wav"))

# Voice over the music (music turned down while the voice speaks).
run("ffmpeg", "-y", "-loglevel", "error", "-i", str(VIDEO), "-i", str(tmp / "voice.wav"), "-i", str(MUSIC),
    "-filter_complex",
    f"[2:a]volume=0.55,afade=t=out:st={total - 2.5}:d=2.5[m];"
    "[1:a]asplit=2[sc][vo];"
    "[m][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[duck];"
    "[duck][vo]amix=inputs=2:normalize=0[a]",
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", str(total),
    "-movflags", "+faststart", str(OUT / "derma-pitch-voice.mp4"))
print("sound ready")
