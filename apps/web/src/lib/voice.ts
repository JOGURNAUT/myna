'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Browser voice call to Myna: Pipecat's JS client over WebRTC. The agent speaks and listens;
 * this hook only turns its messages into state the page can show.
 *
 * Messages from the agent (sent as RTVI "server messages"):
 *   greeting  Myna's opening line (the AI disclosure) and the call id
 *   turn      what the caller said (as transcribed) and Myna's reply
 *   latency   how long that reply took, split into listen / think / speak
 *   error     the agent had a problem
 */

export interface VoiceReply {
  text: string;
  language: string;
  state: string;
  ended: boolean;
  handoffTo: string | null;
}

export interface VoiceLatency {
  turn: number;
  stt_ms: number | null;
  agent_ms: number | null;
  tts_first_audio_ms: number | null;
  total_ms: number | null;
  felt_ms: number | null;
}

export type VoiceStatus = 'idle' | 'connecting' | 'live' | 'ended' | 'error';

export interface VoiceHandlers {
  onGreeting: (reply: VoiceReply) => void;
  onTurn: (caller: string, reply: VoiceReply) => void;
  onLatency: (latency: VoiceLatency) => void;
}

type ServerMessage =
  | { type: 'greeting'; reply: VoiceReply; callId: string }
  | { type: 'turn'; caller: string; reply: VoiceReply }
  | ({ type: 'latency' } & VoiceLatency)
  | { type: 'error'; message: string };

interface Client {
  connect: () => Promise<unknown>;
  disconnect: () => Promise<void>;
}

export function useVoiceCall(handlers: VoiceHandlers) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [speaker, setSpeaker] = useState<'none' | 'you' | 'myna'>('none');
  const [error, setError] = useState<string | null>(null);
  const client = useRef<Client | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  const stop = useCallback(async () => {
    const c = client.current;
    client.current = null;
    await c?.disconnect().catch(() => undefined);
    if (audio.current) audio.current.srcObject = null;
    setSpeaker('none');
    setStatus((s) => (s === 'error' ? s : 'ended'));
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStatus('connecting');
    try {
      // Loaded on demand: the voice libraries are only needed when someone presses the mic.
      const [{ PipecatClient }, { SmallWebRTCTransport }] = await Promise.all([
        import('@pipecat-ai/client-js'),
        import('@pipecat-ai/small-webrtc-transport'),
      ]);
      const pc = new PipecatClient({
        transport: new SmallWebRTCTransport({
          webrtcRequestParams: { endpoint: '/api/voice/offer' },
        }),
        enableMic: true,
        enableCam: false,
        callbacks: {
          onConnected: () => {
            setStatus('live');
          },
          onDisconnected: () => {
            setSpeaker('none');
            setStatus((s) => (s === 'error' ? s : 'ended'));
          },
          onUserStartedSpeaking: () => {
            setSpeaker('you');
          },
          onUserStoppedSpeaking: () => {
            setSpeaker('none');
          },
          onBotStartedSpeaking: () => {
            setSpeaker('myna');
          },
          onBotStoppedSpeaking: () => {
            setSpeaker('none');
          },
          onTrackStarted: (track, participant) => {
            // Play Myna's voice (not our own mic) through a hidden audio element.
            if (track.kind !== 'audio' || participant?.local) return;
            audio.current ??= new Audio();
            audio.current.srcObject = new MediaStream([track]);
            void audio.current.play().catch(() => undefined);
          },
          onServerMessage: (raw: unknown) => {
            const m = raw as ServerMessage;
            if (m.type === 'greeting') latest.current.onGreeting(m.reply);
            else if (m.type === 'turn') latest.current.onTurn(m.caller, m.reply);
            else if (m.type === 'latency') latest.current.onLatency(m);
            else setError(m.message);
          },
          onError: () => {
            setError('The voice connection had a problem.');
          },
        },
      });
      client.current = pc;
      await pc.connect();
    } catch (e) {
      client.current = null;
      setStatus('error');
      const denied = e instanceof Error && /permission|denied|notallowed/i.test(e.message);
      setError(
        denied
          ? 'Myna needs microphone access to hear you. Allow it in your browser and try again.'
          : 'Could not start the voice call. You can still type to Myna.',
      );
    }
  }, []);

  useEffect(
    () => () => {
      void client.current?.disconnect().catch(() => undefined);
    },
    [],
  );

  return { status, speaker, error, start, stop };
}
