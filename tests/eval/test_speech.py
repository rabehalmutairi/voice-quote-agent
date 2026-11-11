import json
import shutil
import subprocess
import wave

import httpx
import pytest

from eval.speech import Clip, collect, main, phone_simulate, score
from eval.speech_audit import audit_sheet, score_audit


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


def test_audit_scores_value_in_context_and_counts_extra_values():
    clips = [Clip("one", "call", None, "الأصلي ١٢٠٠ والتجاري ٤٥٠", (1200, 450))]
    transcripts = {
        "scribe": {"one": "التجاري 450 والأصلي 1200"},
        "deepgram": {"one": "التجاري 1200 والأصلي 450 والضمان 30 يوم"},
    }
    sheet = audit_sheet(clips, transcripts)
    row = sheet[0]
    gold = [
        {"field": "price_sar", "scope": "original", "value": 1200},
        {"field": "price_sar", "scope": "commercial", "value": 450},
    ]
    row["reference"]["mentions"] = gold
    row["scribe"]["mentions"] = list(reversed(gold))
    row["deepgram"]["mentions"] = [
        {**gold[0], "value": 450}, {**gold[1], "value": 1200},
        {"field": "warranty_days", "scope": "original", "value": 30},
    ]

    report = score_audit(clips, transcripts, sheet)
    assert report["call"]["reviewed_clips"] == 1
    assert report["call"]["scribe"]["all"] == (2, 0, 0)
    assert report["call"]["deepgram"]["all"] == (0, 2, 3)
    assert report["call"]["deepgram"]["price_sar"] == (0, 2, 2)
    assert report["call"]["deepgram"]["warranty_days"] == (0, 0, 1)


def test_audit_requires_paired_reviews_and_rejects_stale_transcripts():
    clips = [Clip("one", "sada", None, "حياك الله", ())]
    transcripts = {provider: {"one": "حياك الله"} for provider in ("scribe", "deepgram")}
    sheet = audit_sheet(clips, transcripts)
    sheet[0]["reference"]["mentions"] = []
    sheet[0]["scribe"]["mentions"] = []
    report = score_audit(clips, transcripts, sheet)
    assert report["all"]["reviewed_clips"] == 0
    sheet[0]["deepgram"]["mentions"] = []
    assert score_audit(clips, transcripts, sheet)["all"]["reviewed_clips"] == 1
    transcripts["scribe"]["one"] = "الله يحييك"
    with pytest.raises(ValueError, match="changed since"):
        score_audit(clips, transcripts, sheet)


@pytest.mark.parametrize("value", [True, -1, [60], [120, 60], "an hour"])
def test_audit_validates_canonical_number_or_range(value):
    clips = [Clip("one", "call", None, "من ساعة لساعتين", ())]
    transcripts = {provider: {"one": "من ساعة لساعتين"} for provider in ("scribe", "deepgram")}
    sheet = audit_sheet(clips, transcripts)
    for column in ("reference", "scribe", "deepgram"):
        sheet[0][column]["mentions"] = [
            {"field": "turnaround_minutes", "scope": "call", "value": value}
        ]
    with pytest.raises(ValueError, match="turnaround_minutes"):
        score_audit(clips, transcripts, sheet)


def test_audit_cli_exports_and_scores_cached_transcripts(tmp_path, capsys):
    audio = tmp_path / "clip.wav"
    audio.write_bytes(b"audio")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps([
        {"id": "one", "source": "call", "audio": "clip.wav", "reference": "Warranty 30 days", "numbers": [30]},
    ]), encoding="utf-8")
    cache = tmp_path / "cache"
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={
        "text": "Warranty thirty days",
        "results": {"channels": [{"alternatives": [{"transcript": "Warranty 30 days"}]}]},
    }))) as client:
        collect([Clip("one", "call", audio, "Warranty 30 days", (30,))], cache, client,
                {"scribe": "scribe-key", "deepgram": "deepgram-key"})

    audit = tmp_path / "audit.json"
    args = [str(manifest), "--cache", str(cache)]
    assert main(["audit-sheet", *args, "--output", str(audit)]) == 0
    with pytest.raises(SystemExit):
        main(["audit-sheet", *args, "--output", str(audit)])
    rows = json.loads(audit.read_text(encoding="utf-8"))
    for column in ("reference", "scribe", "deepgram"):
        rows[0][column]["mentions"] = [{"field": "warranty_days", "scope": "item", "value": 30}]
    audit.write_text(json.dumps(rows), encoding="utf-8")
    assert main(["score", *args, "--audit", str(audit)]) == 0
    assert "1/1 clips reviewed" in capsys.readouterr().out


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
