"""Prepare phone-quality clips and run a paired Scribe / Deepgram speech benchmark."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import httpx

from eval.arabic import tokens
from eval.numbers import parse_numbers

_PROVIDERS = {
    "scribe": ("scribe_v2", "ara", "ELEVENLABS_API_KEY"),
    "deepgram": ("nova-3", "ar-SA", "DEEPGRAM_API_KEY"),
}
_SOURCES = ("sada", "call")
_CLIP_ID = re.compile(r"[A-Za-z0-9_-]{1,100}")


@dataclass(frozen=True)
class Clip:
    id: str
    source: str
    audio: Path | None
    reference: str
    numbers: tuple[float, ...]


def phone_simulate(source: Path, target: Path) -> None:
    """Encode 300–3400 Hz, mono, 8 kHz G.711 μ-law in a WAV container."""
    if source.resolve() == target.resolve() or (target.exists() and target.samefile(source)):
        raise ValueError("source and target must be different; they refer to the same file")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target.parent) as temp:
        output = Path(temp) / "phone.wav"
        process = subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", str(source),
             "-map", "0:a:0", "-af", "highpass=f=300,lowpass=f=3400",
             "-ac", "1", "-ar", "8000", "-c:a", "pcm_mulaw", str(output)],
            capture_output=True, encoding="utf-8", errors="replace",
        )
        if process.returncode:
            raise ValueError(f"ffmpeg could not prepare the clip: {process.stderr.strip()}")
        output.replace(target)


def load_clips(manifest: Path) -> list[Clip]:
    rows = json.loads(manifest.read_text(encoding="utf-8"))
    if not isinstance(rows, list) or not rows:
        raise ValueError("manifest must be a non-empty JSON array")
    clips = []
    for row in rows:
        numbers = row["numbers"]
        if not isinstance(numbers, list) or not all(
            type(n) in (int, float) and math.isfinite(n) and n >= 0 for n in numbers
        ):
            raise ValueError("numbers must list the spoken non-negative numbers in order")
        audio = manifest.parent / row["audio"]
        if audio.suffix.lower() != ".wav":
            raise ValueError(f"{row['id']}: supply the benchmark audio as WAV")
        clips.append(Clip(row["id"], row["source"], audio, row["reference"], tuple(numbers)))
    _check_clips(clips)
    return clips


def _check_clips(clips: list[Clip]) -> set[str]:
    ids = set()
    for clip in clips:
        if not _CLIP_ID.fullmatch(clip.id) or clip.id.lower() in ids:
            raise ValueError("clip IDs must be unique and contain only letters, digits, - or _")
        if clip.source not in _SOURCES or not tokens(clip.reference):
            raise ValueError(f"{clip.id}: supply source sada or call and a non-empty reference")
        ids.add(clip.id.lower())
    if not ids:
        raise ValueError("provide at least one clip")
    return {clip.id for clip in clips}


def _transcribe(provider: str, client: httpx.Client, api_key: str, audio: bytes) -> str:
    model, language, _ = _PROVIDERS[provider]
    if provider == "scribe":
        response = client.post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers={"xi-api-key": api_key},
            data={"model_id": model, "language_code": language, "tag_audio_events": "false"},
            files={"file": ("clip.wav", audio, "audio/wav")},
        )
        response.raise_for_status()
        transcript = response.json()["text"]
    else:
        response = client.post(
            "https://api.deepgram.com/v1/listen",
            params={"model": model, "language": language},
            headers={"Authorization": f"Token {api_key}", "Content-Type": "audio/wav"},
            content=audio,
        )
        response.raise_for_status()
        transcript = response.json()["results"]["channels"][0]["alternatives"][0]["transcript"]
    if not isinstance(transcript, str):
        raise ValueError("transcript must be a string")
    return transcript


def _read_cache(path: Path, fingerprint: dict) -> str | None:
    if path.is_file():
        data = json.loads(path.read_text(encoding="utf-8"))
        if all(data.get(k) == v for k, v in fingerprint.items()) and isinstance(data.get("text"), str):
            return data["text"]
    return None


def collect(
    clips: list[Clip], cache: Path, client: httpx.Client | None, keys: dict[str, str]
) -> dict[str, dict[str, str]]:
    """Transcribe the same bytes with both providers, reusing completed clips by audio hash."""
    _check_clips(clips)
    transcripts: dict[str, dict[str, str]] = {provider: {} for provider in _PROVIDERS}
    for clip in clips:
        if clip.audio is None:
            raise ValueError(f"{clip.id}: audio is required to collect transcripts")
        audio = clip.audio.read_bytes()
        digest = hashlib.sha256(audio).hexdigest()
        for provider, (model, language, variable) in _PROVIDERS.items():
            path = cache / provider / f"{clip.id}.json"
            fingerprint = {"sha256": digest, "model": model, "language": language}
            transcript = _read_cache(path, fingerprint)
            if transcript is None:
                if client is None or not keys.get(provider):
                    raise ValueError(f"{clip.id}: missing cached {provider} transcript; run with {variable}")
                try:
                    transcript = _transcribe(provider, client, keys[provider], audio)
                except httpx.HTTPStatusError as exc:
                    raise ValueError(f"{clip.id}: {provider} returned HTTP {exc.response.status_code}") from exc
                except httpx.RequestError as exc:
                    raise ValueError(f"{clip.id}: {provider} request failed ({type(exc).__name__})") from exc
                except (ValueError, TypeError, KeyError, IndexError) as exc:
                    raise ValueError(f"{clip.id}: {provider} returned an invalid transcript") from exc
                path.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.TemporaryDirectory(dir=path.parent) as temp:
                    partial = Path(temp) / "transcript.json"
                    partial.write_text(
                        json.dumps({**fingerprint, "text": transcript}, ensure_ascii=False),
                        encoding="utf-8",
                    )
                    partial.replace(path)
            transcripts[provider][clip.id] = transcript
    return transcripts


def _distance(reference: Sequence, hypothesis: Sequence) -> int:
    """Levenshtein edits with one row of storage."""
    previous = list(range(len(hypothesis) + 1))
    for i, expected in enumerate(reference, 1):
        current = [i]
        for j, actual in enumerate(hypothesis, 1):
            current.append(min(previous[j] + 1, current[-1] + 1, previous[j - 1] + (expected != actual)))
        previous = current
    return previous[-1]


def score(clips: list[Clip], transcripts: dict[str, dict[str, str]]) -> dict:
    """Report corpus word errors and ordered numeric accuracy on identical clip sets."""
    ids = _check_clips(clips)
    if transcripts.keys() != _PROVIDERS.keys() or any(set(items) != ids for items in transcripts.values()):
        raise ValueError("both providers must have exactly the manifest's clip IDs")
    report: dict = {
        group: {
            provider: {"clips": 0, "word_errors": (0, 0), "numbers_correct": (0, 0)}
            for provider in _PROVIDERS
        }
        for group in ("all", *_SOURCES) if group == "all" or any(c.source == group for c in clips)
    }
    for clip in clips:
        reference = tokens(clip.reference)
        for provider, items in transcripts.items():
            transcript = items[clip.id]
            hypothesis = tokens(transcript)
            numbers = parse_numbers(transcript)
            word_errors = _distance(reference, hypothesis)
            numeric_total = max(len(clip.numbers), len(numbers))
            numeric_correct = numeric_total - _distance(clip.numbers, numbers)
            for group in ("all", clip.source):
                row = report[group][provider]
                row["clips"] += 1
                errors, words = row["word_errors"]
                row["word_errors"] = (errors + word_errors, words + len(reference))
                correct, total = row["numbers_correct"]
                row["numbers_correct"] = (correct + numeric_correct, total + numeric_total)
    return report


def _rate(pair: tuple[int, int]) -> str:
    count, total = pair
    return f"{count / total:.1%} ({count}/{total})" if total else "N/A (0 samples)"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    phone = commands.add_parser("phone", help="prepare one 8 kHz μ-law WAV with ffmpeg")
    phone.add_argument("source", type=Path)
    phone.add_argument("target", type=Path)
    for name in ("run", "score"):
        benchmark = commands.add_parser(name, help="use APIs and cache" if name == "run" else "use cache offline")
        benchmark.add_argument("manifest", type=Path)
        benchmark.add_argument("--cache", type=Path, default=Path("data/asr-cache"))
    args = parser.parse_args(argv)
    try:
        if args.command == "phone":
            phone_simulate(args.source, args.target)
            return 0
        clips = load_clips(args.manifest)
        if args.command == "run":
            keys = {provider: os.environ.get(variable, "") for provider, (_, _, variable) in _PROVIDERS.items()}
            with httpx.Client(timeout=120) as client:
                transcripts = collect(clips, args.cache, client, keys)
        else:
            transcripts = collect(clips, args.cache, None, {})
        for group, providers in score(clips, transcripts).items():
            for provider, values in providers.items():
                model, language, _ = _PROVIDERS[provider]
                print(f"{group:<5} {model} ({language}), {values['clips']} clips  "
                      f"WER {_rate(values['word_errors'])}  numbers {_rate(values['numbers_correct'])}")
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
