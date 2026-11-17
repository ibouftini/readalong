"""Writes assets/chime.wav: the soft "ding ding" auto-read plays before it reads an answer.

Two bell strikes a major third apart (C6, then E6), each a few slightly inharmonic partials
with a soft attack and an exponential decay, kept quiet (peak about -15 dBFS).
Run from the repository: python3 assets/chime.py
"""

import math
import struct
import wave
from pathlib import Path

RATE = 44100
LENGTH = 0.9  # seconds
PEAK = 0.18  # of full scale

# (frequency ratio, amplitude, decay speed): a bell's partials.
PARTIALS = [(1.0, 1.0, 1.0), (2.0, 0.22, 1.6), (3.01, 0.07, 2.4)]
# (start in seconds, fundamental in Hz, loudness): ding, then ding.
STRIKES = [(0.0, 1046.5, 1.0), (0.16, 1318.5, 0.85)]
DECAY = 0.22  # seconds for the fundamental to fall to 1/e
ATTACK = 0.006  # seconds


def sample(t: float) -> float:
    value = 0.0
    for start, base, loudness in STRIKES:
        s = t - start
        if s < 0:
            continue
        attack = 0.5 - 0.5 * math.cos(math.pi * s / ATTACK) if s < ATTACK else 1.0
        for ratio, amplitude, speed in PARTIALS:
            value += loudness * amplitude * attack * math.exp(-s * speed / DECAY) * math.sin(2 * math.pi * base * ratio * s)
    # A short fade at the very end, so the file stops on silence.
    tail = LENGTH - t
    return value * (min(1.0, tail / 0.05) if tail < 0.05 else 1.0)


def main() -> None:
    samples = [sample(i / RATE) for i in range(int(RATE * LENGTH))]
    scale = PEAK / max(abs(v) for v in samples)
    out = Path(__file__).with_name("chime.wav")
    with wave.open(str(out), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(b"".join(struct.pack("<h", round(v * scale * 32767)) for v in samples))
    print(f"wrote {out} ({len(samples) / RATE:.2f} s)")


if __name__ == "__main__":
    main()
