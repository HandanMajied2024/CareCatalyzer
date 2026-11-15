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
  'You are an empathetic AI Oncology Care Coordinator for FICAN calling a patient on the Lung Cancer Fast-Track Pathway. ' +
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
    return ai.models.generateContent({
      model: modelName,
      contents: `Evaluate this Lung Cancer Fast-Track outreach call turn and return structured JSON:\n\n${payload}${instructionSuffix}`,
      config: {
        systemInstruction: COORDINATOR_SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: CALL_TURN_SCHEMA,
      },
    });
  };

  const modelUsed = GEMINI_CHAT_MODEL;
  try {
    const response = await callModel(modelUsed);

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
    console.warn('Gemini call-turn failed. Check API access, quota, and GEMINI_CHAT_MODEL.');
    throw new Error('Gemini could not respond. Check the API key, model access and quota, then try again.');
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'fican-careconnect-lung-pathway',
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
                    prebuiltVoiceConfig: { voiceName: 'Charon' },
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
                    reason: 'Live voice stream interrupted; switching to structured fallback.',
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
              reason: 'Gemini Live unavailable; using browser speech recognition with Gemini chat.',
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
    console.log(`FICAN CareConnect Lung Pathway server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Server startup error:', err);
  process.exit(1);
});
