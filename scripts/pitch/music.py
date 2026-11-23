"""Composes the pitch video's background music (scripts/pitch/music.m4a): a calm, warm progression
(D – Bm – G – A) with a soft pad, a low bass and a light plucked arpeggio. Made here, so no licence
is needed. Run: python3 scripts/pitch/music.py [seconds] (then ffmpeg to .m4a, see the end)."""
import sys
import wave

import numpy as np

SR = 44100
BPM = 84
beat = 60 / BPM
bar = 4 * beat
dur = float(sys.argv[1]) if len(sys.argv) > 1 else 106.0
N = int(SR * dur)
L = np.zeros(N)
R = np.zeros(N)


def f(n):
    return 440 * 2 ** ((n - 69) / 12)


prog = [[50, 62, 66, 69, 74], [47, 59, 62, 66, 71], [43, 59, 62, 67, 71], [45, 57, 61, 64, 69]]


def add(sig, start, pan=0.0, gain=1.0):
    i = int(start * SR)
    j = min(N, i + len(sig))
    if i >= N:
        return
    s = sig[: j - i] * gain
    L[i:j] += s * np.sqrt(0.5 * (1 - pan))
    R[i:j] += s * np.sqrt(0.5 * (1 + pan))


def pad(notes, length):
    n = int(length * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in notes[1:]:
        for d in (-0.07, 0.0, 0.06):
            out += np.sin(2 * np.pi * f(m) * (1 + d / 100) * t) * 0.6 + 0.15 * np.sin(2 * np.pi * 2 * f(m) * t)
    env = np.minimum(1, t / 1.2) * np.minimum(1, (length - t) / 1.0)
    return out * env / len(notes) / 3


def pluck(m, length=1.6):
    n = int(length * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f(m) * t) + 0.3 * np.sin(2 * np.pi * 2 * f(m) * t) + 0.1 * np.sin(2 * np.pi * 3 * f(m) * t)
    return s * np.exp(-t * 3.2) * np.minimum(1, t / 0.005)


def bass(m, length):
    n = int(length * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * f(m - 12) * t) * np.minimum(1, t / 0.02) * np.exp(-t * 0.6)


t = 0.0
k = 0
while t < dur:
    ch = prog[k % 4]
    add(pad(ch, bar + 0.8), t, 0, 0.22)
    if t >= bar:
        add(bass(ch[0], bar), t, 0, 0.35)
    if t >= bar * 2:
        arp = [ch[1], ch[2], ch[3], ch[4], ch[3], ch[2], ch[4] + 12, ch[3]]
        for i, m in enumerate(arp):
            add(pluck(m + 12 if i % 4 == 2 else m), t + i * beat / 2, (-0.4 if i % 2 else 0.4), 0.10)
    t += bar
    k += 1


def delay(x, d=0.31, fb=0.28):
    y = x.copy()
    n = int(d * SR)
    for i in range(1, 6):
        y[n * i :] += x[: -n * i] * (fb**i)
    return y


L = delay(L)
R = delay(R, 0.37)
ta = np.arange(N) / SR
env = np.minimum(1, ta / 1.5) * np.minimum(1, (dur - ta) / 4.0)
L *= env
R *= env
m = max(np.abs(L).max(), np.abs(R).max())
L /= m / 0.6
R /= m / 0.6
st = (np.stack([L, R], 1) * 32767).astype(np.int16)
w = wave.open("music.wav", "wb")
w.setnchannels(2)
w.setsampwidth(2)
w.setframerate(SR)
w.writeframes(st.tobytes())
w.close()
# ffmpeg -y -i music.wav -c:a aac -b:a 160k scripts/pitch/music.m4a
