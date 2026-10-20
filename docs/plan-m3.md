# Plan — Milestone 3: browser voice, audio-mode Hawk, latency

Status: **built (2026-10-20)**, approved with "ok for everything". Phone (telephony) is Milestone 5.

## What it is

```
browser mic ──WebRTC──► Silero VAD ► Saaras STT ► turn manager ► MynaTurn ► Bulbul TTS ──WebRTC──► speaker
                                                                  │
                                                                  └─► the agent's /v1/calls/{id}/turns
                                                                      (same logic Hawk and the web chat use)
```

- **Pipecat owns** transport, voice-activity detection, the Sarvam services, and barge-in
  (`UserTurnProcessor` with the external turn strategies Saaras' own VAD drives).
- **Myna owns** `MynaTurn`: each final transcript is one caller turn, sent through the agent's HTTP
  app *in-process*, so there is one brain and no second copy of the rules. The reply is a fixed
  template; Bulbul speaks it. No LLM writes speech, so the safety guarantees hold on voice too.
- The reply's language picks Bulbul's language for that utterance, so switching mid-call works.
- Everything is optional: no `SARVAM_API_KEY` → no voice routes, text path unchanged.

## Verified against the installed packages (not assumed)

| Thing | Value | Source |
|---|---|---|
| Pipecat | `pipecat-ai[sarvam,webrtc]` **1.13.0** (docs mention 1.3 renames: `PipelineTask`→`PipelineWorker`, `PipelineRunner`→`WorkerRunner`; both work, old ones are deprecated) | installed source |
| STT | `SarvamRealtimeSTTService`, model **`saaras:v4`** (also `saaras:v3-realtime`), `language=None` = detect per utterance | docstring + live run |
| TTS | `SarvamTTSService`, model **`bulbul:v3`**, voice `priya` (`bulbul:v4-flash` has a different voice catalogue) | docstring + REST docs |
| REST (Hawk audio mode) | `POST /text-to-speech`, `POST /speech-to-text` (≤ 30 s clips) | Sarvam API docs |
| Browser client | `@pipecat-ai/client-js` 1.14.0 + `@pipecat-ai/small-webrtc-transport` 1.11.0 | npm |

Doc vs API mismatches found while building: the production guide says TTS `min_buffer_size`
15–25; the live API rejects anything under **30**. The guide says not to add a Pipecat VAD; the
installed realtime STT docstring says a VAD analyzer **is** required. We followed the installed
code and the live service.

## Latency (measured, `tests/test_voice_live.py`, rule-based understanding)

From the moment the speech detector decides the caller stopped: **listen 240 ms + think 45 ms +
first audio 208 ms = 493 ms**. The detector itself waits 450 ms of silence first, so the pause the
caller feels is about **0.95 s** against the 1.5 s target. With the Sarvam model doing the
understanding add its ~370 ms p50 (Hawk run 04). Logged per turn as JSON (`voice_turn`) and shown
in the UI as the felt latency.

## Audio-mode Hawk

`pnpm hawk run --audio --sample N`: each simulated caller line goes text → Bulbul → Saaras → agent.
The report adds recognition latency, character error rate (English, Hindi), what recognition
changed most, and an estimated speech cost per call. REST per utterance, not streaming: same
recogniser, simpler plumbing (the streaming path is what `test_voice_webrtc.py` covers).

## Not in this milestone

Telephony (Exotel/Plivo), recording, a TURN server for browsers behind strict NATs (needed in a
real deployment; localhost works), a regional language.
