import shutil
import subprocess
import wave

import httpx
import pytest

from eval.speech import Clip, collect, phone_simulate, score


def test_scoring_is_paired_by_clip_and_numbers_use_semantic_value():
    clips = [
        Clip("one", "sada", None, "السعر ثلاثمية وخمسين", (350,)),
        Clip("two", "call", None, "حياك الله", ()),
    ]
    report = score(clips, {
        "scribe": {"one": "السعر ٣٥٠", "two": "حياك الله"},
        "deepgram": {"one": "السعر ٣٠٠", "two": "حياك الله 5"},
    })
    assert report["all"]["scribe"]["word_errors"] == (2, 5)
    assert report["all"]["scribe"]["numbers_correct"] == (1, 1)
    assert report["all"]["deepgram"]["numbers_correct"] == (0, 2)
    assert report["sada"]["scribe"]["clips"] == 1
    assert report["call"]["scribe"]["numbers_correct"] == (0, 0)
    with pytest.raises(ValueError, match="clip IDs"):
        score(clips, {"scribe": {"one": "السعر ٣٥٠"}, "deepgram": {}})


def test_provider_requests_use_the_same_audio_and_resume(tmp_path):
    path = tmp_path / "test.wav"
    path.write_bytes(b"fixture wav")
    clips = [Clip("one", "sada", path, "السعر ثلاثمية وخمسين", (350,))]
    calls = []

    def respond(request):
        calls.append(request.url.host)
        assert b"fixture wav" in request.content
        if request.url.host == "api.elevenlabs.io":
            assert request.headers["xi-api-key"] == "test-scribe"
            assert b"scribe_v2" in request.content and b"ara" in request.content
            return httpx.Response(200, json={"text": "السعر ٣٥٠"})
        assert request.url.params["model"] == "nova-3"
        assert request.url.params["language"] == "ar-SA"
        assert request.headers["Authorization"] == "Token test-deepgram"
        return httpx.Response(200, json={
            "results": {"channels": [{"alternatives": [{"transcript": "السعر ٣٥٠"}]}]},
        })

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        keys = {"scribe": "test-scribe", "deepgram": "test-deepgram"}
        assert collect(clips, tmp_path / "cache", client, keys)["scribe"] == {"one": "السعر ٣٥٠"}
        assert collect(clips, tmp_path / "cache", client, {})["deepgram"] == {"one": "السعر ٣٥٠"}
        assert len(calls) == 2
        path.write_bytes(b"new fixture wav")
        collect(clips, tmp_path / "cache", client, keys)
    assert len(calls) == 4


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg is needed to encode a phone clip")
def test_phone_simulation_encodes_8khz_mono_mulaw(tmp_path):
    source, target = tmp_path / "in.wav", tmp_path / "out.wav"
    with wave.open(str(source), "wb") as wav:
        wav.setparams((2, 2, 16000, 0, "NONE", "not compressed"))
        wav.writeframes(b"\0" * 32000)
    phone_simulate(source, target)
    info = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(target)],
                          capture_output=True, text=True).stderr
    assert "pcm_mulaw" in info and "8000 Hz, mono" in info
    with pytest.raises(ValueError, match="same file"):
        phone_simulate(source, source)
