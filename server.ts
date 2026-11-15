import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import {
  ActivityHandling,
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
  ThinkingLevel,
  Type,
} from '@google/genai';
import type {
  BarrierCategory,
  CallTurnApiResponse,
  TranscriptLine,
} from './src/types/careconnect.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL?.trim() || 'gemini-3.8-flash';
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL?.trim() || 'gemini-3.8-live';
// If the primary chat model is overloaded (503) or slow, try these in order.
const GEMINI_CHAT_FALLBACK_MODELS = (process.env.GEMINI_CHAT_FALLBACK_MODELS ?? 'gemini-3-flash-preview,gemini-3.5-flash')
  .split(',').map((m) => m.trim()).filter(Boolean);
const GEMINI_TURN_TIMEOUT_MS = Number(process.env.GEMINI_TURN_TIMEOUT_MS || 10000);
const GEMINI_LIVE_VOICE = process.env.GEMINI_LIVE_VOICE?.trim() || 'Charon'; // male prebuilt voice
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL?.trim() || 'gemini-2.5-flash-preview-tts';
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL?.trim() || 'eleven_flash_v2_5';
const TTS_VOICES = {
  male: {
    eleven: process.env.ELEVENLABS_VOICE_ID_MALE?.trim() || 'pNInz6obpgDQGcFmaJgB', // Adam
    gemini: process.env.GEMINI_TTS_VOICE_MALE?.trim() || 'Charon',
  },
  female: {
    eleven: process.env.ELEVENLABS_VOICE_ID_FEMALE?.trim() || '21m00Tcm4TlvDq8ikWAM', // Rachel
    gemini: process.env.GEMINI_TTS_VOICE_FEMALE?.trim() || 'Kore',
  },
} as const;
const GEMINI_SETUP_MESSAGE = 'Add GEMINI_API_KEY to the project .env file and restart the server.';

interface PatientContextPayload {
  id: string;
  name: string;
  age: number;
  municipality: string;
  regionId: string;
  hubHospital: string;
  distanceKm: number;
  pathwayStage: string;
  cancerDiagnosis: string;
  cancerStage: string;
  primaryLanguage: string;
  appointmentType: string;
  appointmentTimeLabel: string;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(GEMINI_SETUP_MESSAGE);
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion: 'v1beta',
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const CALL_TURN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    aiReply: {
      type: Type.STRING,
      description:
        'Empathetic response written in clear English from the Finnish Lung Cancer Fast-Track Care Coordinator (1-3 concise sentences).',
    },
    outcome: {
      type: Type.STRING,
      description:
        'Exactly one of: continue_probe, cancellation_reason_requested, cancelled, confirmed, declined_classified, call_ended, no_answer.',
    },
    needsProbe: {
      type: Type.BOOLEAN,
      description:
        'True when another patient reply is required, including the one required cancellation-reason question.',
    },
    barrierCategory: {
      type: Type.STRING,
      nullable: true,
      description:
        'For declined_classified or cancelled, strictly one of: "Transport", "Weather", "Scheduling", "Accessibility", "Language", "Fear / Anxiety", "Financial", "Other". Use Other when the reason is not disclosed. Otherwise null.',
    },
    barrierSummary: {
      type: Type.STRING,
      nullable: true,
      description: 'Short 1-sentence clinical summary of the captured barrier or confirmation.',
    },
    recommendedAction: {
      type: Type.STRING,
      nullable: true,
      description:
        'Short next step. For cancelled, state that cancellation was recorded and rescheduling support can be offered.',
    },
    clinicalNurseAlert: {
      type: Type.BOOLEAN,
      description:
        'True ONLY when the patient reports acute clinical symptoms, fever, severe breathing difficulty, mobility crisis, or frailty/accessibility risk.',
    },
  },
  required: ['aiReply', 'outcome', 'needsProbe', 'clinicalNurseAlert'],
};

const COORDINATOR_SYSTEM_PROMPT =
  'You are the Care Pathway Agent, an empathetic AI oncology care coordinator for the CareCatalyst care team, calling a patient on the Lung Cancer Fast-Track Pathway. ' +
  'Mandatory Safeguards & Rules:\n' +
  '0. LANGUAGE: Conduct the entire conversation in clear, simple English. Never switch to Finnish because of the patient record. Only change language if the patient explicitly asks. Ask one short question at a time, then wait for the patient to answer.\n' +
  '1. CANCELLATION WORKFLOW: When the patient explicitly asks to cancel, you MUST ask exactly once why before cancelling. On that first request, do not cancel; set outcome="cancellation_reason_requested", needsProbe=true, and ask one short reason question. If the patient already stated a reason in the same request, still ask once to confirm that reason.\n' +
  '2. After that reason question has appeared earlier in the transcript, the patient\'s next answer completes the request—even if they decline to explain or say "cancel anyway". Set outcome="cancelled", needsProbe=false, briefly confirm the appointment is cancelled, summarize the answer in barrierSummary, and classify barrierCategory when possible. Never ask why a second time.\n' +
  '3. If the patient clearly confirms attendance ("yes", "I will be there", "confirmed"), set outcome="confirmed", needsProbe=false.\n' +
  '4. If the patient says they may not attend but does NOT explicitly request cancellation, set outcome="continue_probe", needsProbe=true, and ask which barrier is preventing attendance.\n' +
  '5. For a barrier without an explicit cancellation request, set outcome="declined_classified", needsProbe=false, and classify barrierCategory strictly into one of:\n' +
  '   - "Transport" (no bus/ride, distance, no suitable transport)\n' +
  '   - "Weather" (snowstorm, blizzard, icy road closure, extreme sub-zero freeze)\n' +
  '   - "Scheduling" (work shift, employer conflict, caregiver clash, time of day)\n' +
  '   - "Accessibility" (mobility impairment, wheelchair needed, acute fever/dyspnea/weakness/frailty)\n' +
  '   - "Language" (did not understand the appointment language, needs interpreter)\n' +
  '   - "Fear / Anxiety" (patient explicitly reports being scared, anxious, or afraid of the procedure/results)\n' +
  '   - "Financial" (patient explicitly reports costs, money, or affordability preventing attendance)\n' +
  '   Use these same categories for cancellations. Record only the patient-stated main reason; do not infer fear or money problems from the patient profile. Use Other if no reason is provided.\n' +
  '   - "Other"\n' +
  '   Tell the patient that a human care coordinator will follow up to help with the barrier; this explicit promise is what creates a coordinator follow-up task.\n' +
  '6. If acute symptoms, severe dyspnea, fever, or unsafe frailty/mobility are mentioned, set clinicalNurseAlert=true and trigger urgent oncology nurse triage.\n' +
  '7. CALL COMPLETION: After confirming attendance, recording a completed cancellation, or promising coordinator support, give a brief closing response and say goodbye without asking another question. If the patient asks to end the call or says goodbye before any appointment decision, return outcome="call_ended", needsProbe=false; leave the appointment unchanged. Ending the conversation is not a request to cancel the appointment. Preserve an already established appointment outcome when classifying a completed conversation. A pause, thank-you within an unfinished answer, or one completed speech turn alone does not mean the call has ended.';

function normalizeCategory(raw: unknown): BarrierCategory {
  const valid: BarrierCategory[] = [
    'Transport',
    'Weather',
    'Scheduling',
    'Accessibility',
    'Language',
    'Fear / Anxiety',
    'Financial',
    'Other',
  ];
  if (typeof raw !== 'string') return 'Other';
  const lower = raw.trim().toLowerCase();
  const exact = valid.find((v) => v.toLowerCase() === lower);
  if (exact) return exact;
  if (/fear|anxi|scared|afraid/.test(lower)) return 'Fear / Anxiety';
  if (/financ|cost|money|afford/.test(lower)) return 'Financial';
  if (/transport|distance|travel|bus|taxi/.test(lower)) return 'Transport';
  if (/weather|snow|storm|ice/.test(lower)) return 'Weather';
  if (/schedul|time|work|shift/.test(lower)) return 'Scheduling';
  if (/access|mobil|frail|symptom|fever|wheelchair/.test(lower)) return 'Accessibility';
  if (/lang|interpret|confus/.test(lower)) return 'Language';
  return 'Other';
}

async function runGeminiCallTurn(
  patient: PatientContextPayload,
  transcript: TranscriptLine[],
  latestPatientText: string,
  mode: 'turn' | 'finalize'
): Promise<CallTurnApiResponse> {
  const ai = getGeminiClient();
  const payload = JSON.stringify({
    mode,
    patientProfile: patient,
    conversationSoFar: transcript.map((t) => ({
      speaker: t.speaker,
      text: t.text,
      probing: Boolean(t.probing),
    })),
    latestPatientUtterance: latestPatientText,
  });

  const instructionSuffix =
    mode === 'finalize'
      ? ' Classify the latest completed turn using the full ordered transcript. Apply the cancellation workflow exactly.'
      : '';

  const callModel = async (modelName: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TURN_TIMEOUT_MS);
    try {
      return await callModelOnce(modelName, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  };
  const callModelOnce = async (modelName: string, abortSignal: AbortSignal) => {
    return ai.models.generateContent({
      model: modelName,
      contents: `Evaluate this Lung Cancer Fast-Track outreach call turn and return structured JSON:\n\n${payload}${instructionSuffix}`,
      config: {
        systemInstruction: COORDINATOR_SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: CALL_TURN_SCHEMA,
        // Low latency for a phone-like turn; override with GEMINI_THINKING_LEVEL if needed.
        thinkingConfig: { thinkingLevel: (process.env.GEMINI_THINKING_LEVEL?.trim() || 'LOW') as ThinkingLevel },
        abortSignal,
      },
    });
  };

  let modelUsed = GEMINI_CHAT_MODEL;
  try {
    let response: Awaited<ReturnType<typeof callModel>> | null = null;
    let lastError: unknown = null;
    for (const candidate of [GEMINI_CHAT_MODEL, ...GEMINI_CHAT_FALLBACK_MODELS.filter((m) => m !== GEMINI_CHAT_MODEL)]) {
      try {
        response = await callModel(candidate);
        modelUsed = candidate;
        break;
      } catch (err) {
        lastError = err;
        console.warn(`Gemini model ${candidate} failed (${err instanceof Error ? err.message.slice(0, 120) : 'error'}); trying next.`);
      }
    }
    if (!response) throw lastError ?? new Error('No Gemini model responded.');

    const parsed = JSON.parse((response.text ?? '{}').trim()) as Partial<CallTurnApiResponse>;
    if (!parsed || typeof parsed.aiReply !== 'string' || !parsed.aiReply.trim()) {
      throw new Error('Gemini returned an empty reply.');
    }
    const outcome =
      parsed.outcome === 'confirmed' ||
      parsed.outcome === 'cancellation_reason_requested' ||
      parsed.outcome === 'cancelled' ||
      parsed.outcome === 'declined_classified' ||
      parsed.outcome === 'no_answer' ||
      parsed.outcome === 'call_ended' ||
      parsed.outcome === 'continue_probe'
        ? parsed.outcome
        : 'continue_probe';

    return {
      aiReply: parsed.aiReply,
      outcome,
      needsProbe:
        outcome === 'continue_probe' || outcome === 'cancellation_reason_requested'
          ? true
          : Boolean(parsed.needsProbe),
      barrierCategory:
        outcome === 'declined_classified' || outcome === 'cancelled'
          ? normalizeCategory(parsed.barrierCategory)
          : null,
      barrierSummary: parsed.barrierSummary ?? null,
      recommendedAction: parsed.recommendedAction ?? null,
      clinicalNurseAlert: Boolean(parsed.clinicalNurseAlert),
      modelUsed,
    };
  } catch (err) {
    console.warn('Gemini call-turn failed. Check API access, quota, and GEMINI_CHAT_MODEL.', err instanceof Error ? err.message.slice(0, 300) : '');
    throw new Error('Gemini could not respond. Check the API key, model access and quota, then try again.');
  }
}

function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'carecatalyst-care-pathway-agent',
      ttsProvider: process.env.ELEVENLABS_API_KEY?.trim() ? 'elevenlabs' : process.env.GEMINI_API_KEY?.trim() ? 'gemini' : 'browser',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      chatModel: GEMINI_CHAT_MODEL,
      liveModel: GEMINI_LIVE_MODEL,
    });
  });

  app.post('/api/call-turn', async (req, res) => {
    if (!process.env.GEMINI_API_KEY?.trim()) {
      res.status(503).json({ error: GEMINI_SETUP_MESSAGE });
      return;
    }
    try {
      const body = req.body as {
        patient?: PatientContextPayload;
        transcript?: TranscriptLine[];
        latestText?: string;
      };
      if (!body.patient || typeof body.latestText !== 'string' || !body.latestText.trim()) {
        res.status(400).json({ error: 'Patient context and latestText are required.' });
        return;
      }
      const result = await runGeminiCallTurn(
        body.patient,
        Array.isArray(body.transcript) ? body.transcript : [],
        body.latestText.trim(),
        'turn'
      );
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Call turn evaluation failed.';
      res.status(502).json({ error: message });
    }
  });

  app.post('/api/classify-call', async (req, res) => {
    if (!process.env.GEMINI_API_KEY?.trim()) {
      res.status(503).json({ error: GEMINI_SETUP_MESSAGE });
      return;
    }
    try {
      const body = req.body as {
        patient?: PatientContextPayload;
        transcript?: TranscriptLine[];
        summaryText?: string;
      };
      if (!body.patient) {
        res.status(400).json({ error: 'Patient context is required.' });
        return;
      }
      const transcript = Array.isArray(body.transcript) ? body.transcript : [];
      const fallbackText =
        body.summaryText?.trim() ||
        transcript
          .filter((t) => t.speaker === 'Patient')
          .map((t) => t.text)
          .join(' ');
      const result = await runGeminiCallTurn(
        body.patient,
        transcript,
        fallbackText || 'Patient ended call without clear reason',
        'finalize'
      );
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Classification failed.';
      res.status(502).json({ error: message });
    }
  });

  // Text-to-speech for the turn-based call (Plan B) and the personal agent.
  // ElevenLabs first, then Gemini TTS; the client falls back to browser speech on any error.
  app.post('/api/tts', async (req, res) => {
    const body = req.body as { text?: string; voice?: string };
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 1200) : '';
    if (!text) {
      res.status(400).json({ error: 'text is required.' });
      return;
    }
    const voice = body.voice === 'female' ? TTS_VOICES.female : TTS_VOICES.male;
    const elevenKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (elevenKey) {
      try {
        const r = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.eleven)}?output_format=mp3_44100_128`,
          {
            method: 'POST',
            headers: { 'xi-api-key': elevenKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
            body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL }),
            signal: AbortSignal.timeout(10000),
          }
        );
        if (!r.ok) throw new Error(`ElevenLabs HTTP ${r.status}`);
        const audio = Buffer.from(await r.arrayBuffer());
        res.set({ 'Content-Type': 'audio/mpeg', 'X-TTS-Provider': 'elevenlabs', 'Cache-Control': 'no-store' });
        res.send(audio);
        return;
      } catch (err) {
        console.warn('ElevenLabs TTS failed, trying Gemini TTS:', err instanceof Error ? err.message : err);
      }
    }
    if (process.env.GEMINI_API_KEY?.trim()) {
      try {
        const ai = getGeminiClient();
        const response = await ai.models.generateContent({
          model: GEMINI_TTS_MODEL,
          contents: [{ parts: [{ text }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.gemini } } },
          },
        });
        const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        const data = part?.inlineData?.data;
        if (!data) throw new Error('Gemini TTS returned no audio.');
        const pcm = Buffer.from(data, 'base64');
        const rateMatch = /rate=(\d+)/.exec(part?.inlineData?.mimeType ?? '');
        res.set({ 'Content-Type': 'audio/wav', 'X-TTS-Provider': 'gemini', 'Cache-Control': 'no-store' });
        res.send(pcm16ToWav(pcm, rateMatch ? Number(rateMatch[1]) : 24000));
        return;
      } catch (err) {
        console.warn('Gemini TTS failed:', err instanceof Error ? err.message : err);
      }
    }
    res.status(503).json({ error: 'No server TTS available; use browser speech.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/api/live-call' });

  wss.on('connection', (clientWs: WebSocket) => {
    let liveSession: {
      sendRealtimeInput: (input: Record<string, unknown>) => void;
      close: () => void;
    } | null = null;
    let closed = false;

    const safeSend = (payload: Record<string, unknown>) => {
      if (!closed && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const closeLiveSession = () => {
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // noop
        }
        liveSession = null;
      }
    };

    clientWs.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          patient?: PatientContextPayload;
          data?: string;
          text?: string;
          sampleRate?: number;
        };

        if (msg.type === 'start' && msg.patient) {
          if (!process.env.GEMINI_API_KEY?.trim()) {
            safeSend({
              type: 'error',
              reason: GEMINI_SETUP_MESSAGE,
            });
            return;
          }

          const p = msg.patient;
          const ai = getGeminiClient();
          const liveSystemInstruction =
            `${COORDINATOR_SYSTEM_PROMPT}\n\n` +
            `Speaking live with ${p.name} (Age ${p.age}, Municipality ${p.municipality}, Distance ${p.distanceKm} km from ${p.hubHospital}, ` +
            `Pathway Stage: ${p.pathwayStage}, Language: ${p.primaryLanguage}). ` +
            `Appointment: ${p.appointmentType} (${p.appointmentTimeLabel}). ` +
            `Greet ${p.name} warmly and confirm their ${p.appointmentType}. Follow the one-question cancellation workflow exactly.`;

          try {
            const session = await ai.live.connect({
              model: GEMINI_LIVE_MODEL,
              config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                  languageCode: 'en-US',
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: GEMINI_LIVE_VOICE },
                  },
                },
                inputAudioTranscription: {
                  languageCodes: ['en-US'],
                  customVocabulary: [
                    p.name,
                    p.municipality,
                    p.appointmentType,
                    'appointment',
                    'transport',
                    'biopsy',
                  ],
                },
                outputAudioTranscription: { languageCodes: ['en-US'] },
                realtimeInputConfig: {
                  activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
                  automaticActivityDetection: {
                    disabled: false,
                    startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
                    endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
                    prefixPaddingMs: 300,
                    silenceDurationMs: 1200,
                  },
                },
                systemInstruction: liveSystemInstruction,
              },
              callbacks: {
                onopen: () => {},
                onmessage: (serverMsg) => {
                  const sc = serverMsg.serverContent;
                  if (!sc) return;

                  if (sc.interrupted) {
                    safeSend({ type: 'interrupted' });
                  }
                  if (sc.inputTranscription?.text) {
                    safeSend({ type: 'user_transcript', text: sc.inputTranscription.text });
                  }
                  if (sc.outputTranscription?.text) {
                    safeSend({ type: 'ai_transcript', text: sc.outputTranscription.text });
                  }
                  if (sc.modelTurn?.parts) {
                    for (const part of sc.modelTurn.parts) {
                      if (part.inlineData?.data) {
                        safeSend({ type: 'audio', data: part.inlineData.data });
                      }
                    }
                  }
                  if (sc.turnComplete) {
                    safeSend({ type: 'turn_complete' });
                  }
                },
                onerror: () => {
                  console.warn('Gemini Live session error. Check model access, network and quota.');
                  safeSend({
                    type: 'fallback',
                    reason: 'Live voice stream interrupted; switching to turn-based Gemini call (Plan B).',
                  });
                },
                onclose: () => {
                  safeSend({ type: 'live_closed' });
                },
              },
            });

            if (closed) { session.close(); return; }
            liveSession = session as unknown as {
              sendRealtimeInput: (input: Record<string, unknown>) => void;
              close: () => void;
            };

            safeSend({ type: 'ready', model: GEMINI_LIVE_MODEL });
            liveSession.sendRealtimeInput({
              text: `The outbound call connected to ${p.name}. Greet them now and confirm their ${p.appointmentType}.`,
            });
          } catch (connectErr) {
            console.warn('Failed to open Gemini Live. Check API access, quota, and GEMINI_LIVE_MODEL.');
            safeSend({
              type: 'fallback',
              reason: 'Gemini Live unavailable; switching to turn-based Gemini call (Plan B).',
            });
          }
          return;
        }

        if (msg.type === 'audio' && msg.data && liveSession) {
          const sampleRate = Number.isFinite(msg.sampleRate)
            ? Math.min(96000, Math.max(8000, Math.round(msg.sampleRate as number)))
            : 16000;
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: `audio/pcm;rate=${sampleRate}`,
            },
          });
          return;
        }

        if (msg.type === 'text' && msg.text && liveSession) {
          liveSession.sendRealtimeInput({ text: msg.text });
          return;
        }

        if (msg.type === 'stop') {
          closeLiveSession();
        }
      } catch (err) {
        console.warn('Live WS message error:', err);
      }
    });

    clientWs.on('close', () => {
      closed = true;
      closeLiveSession();
    });

    clientWs.on('error', () => {
      closed = true;
      closeLiveSession();
    });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`CareCatalyst Care Pathway Agent server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Server startup error:', err);
  process.exit(1);
});
