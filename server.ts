import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import type {
  BarrierCategory,
  CallTurnApiResponse,
  TranscriptLine,
} from './src/types/careconnect.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;

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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
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
        'Empathetic spoken response from the Finnish Lung Cancer Fast-Track Care Coordinator (1-3 concise sentences).',
    },
    outcome: {
      type: Type.STRING,
      description:
        'Exactly one of: continue_probe, confirmed, declined_classified, no_answer.',
    },
    needsProbe: {
      type: Type.BOOLEAN,
      description:
        'True if the patient refused or hesitated without giving a clear barrier yet.',
    },
    barrierCategory: {
      type: Type.STRING,
      nullable: true,
      description:
        'When declined_classified, strictly one of: "Transport", "Weather", "Scheduling", "Accessibility", "Language", "Other". Otherwise null.',
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
        'Concrete Finnish Goal 3 intervention while keeping the appointment held (e.g., Kela upfront taxi voucher, Shared Medical Shuttle, Care Coordinator callback, Kotisairaala nurse check, interpreter).',
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
  'You are an empathetic AI Oncology Care Coordinator for FICAN (Finland National Cancer Strategy 2026–2035, Goal 3) calling a patient on the Lung Cancer Fast-Track Pathway. ' +
  'Mandatory Safeguards & Rules:\n' +
  '1. NEVER auto-cancel an appointment! Always reassure the patient that their fast-track slot is held/protected and a human Care Coordinator (nimetty työntekijä) can follow up.\n' +
  '2. If the patient clearly confirms attendance ("yes", "I will be there", "confirmed"), set outcome="confirmed", needsProbe=false.\n' +
  '3. PROBING RULE: If the patient says they cannot come or want to cancel WITHOUT giving a specific reason (e.g. "I can\'t make it", "I need to cancel"), NEVER end the call! Set outcome="continue_probe", needsProbe=true, and gently ask what specific barrier is preventing attendance (transport, winter weather, scheduling/work, physical accessibility/symptoms, or language/instructions).\n' +
  '4. Once a concrete barrier is provided, set outcome="declined_classified", needsProbe=false, and classify barrierCategory strictly into one of:\n' +
  '   - "Transport" (no bus/ride, long distance >100-400 km, taxi/travel cost)\n' +
  '   - "Weather" (snowstorm, blizzard, icy road closure, extreme sub-zero freeze)\n' +
  '   - "Scheduling" (work shift, employer conflict, caregiver clash, time of day)\n' +
  '   - "Accessibility" (mobility impairment, wheelchair needed, acute fever/dyspnea/weakness/frailty)\n' +
  '   - "Language" (did not understand Finnish/Swedish letter, fear/confusion, needs interpreter)\n' +
  '   - "Other"\n' +
  '5. If acute symptoms, severe dyspnea, fever, or unsafe frailty/mobility are mentioned, set clinicalNurseAlert=true and trigger urgent oncology nurse triage.';

function deterministicFallbackTurn(
  patient: PatientContextPayload,
  transcript: TranscriptLine[],
  latestText: string
): CallTurnApiResponse {
  const lower = latestText.toLowerCase();

  if (/\b(no answer|voicemail|unanswered|no pick-up|ring out)\b/.test(lower)) {
    return {
      aiReply: `No answer from ${patient.name}. Keeping ${patient.appointmentType} held, logging No Pick-Up (+14 risk pts), and queuing a Care Coordinator (nimetty työntekijä) callback.`,
      outcome: 'no_answer',
      needsProbe: false,
      barrierCategory: null,
      barrierSummary: 'Outbound call unanswered / voicemail reached.',
      recommendedAction:
        'Hold fast-track slot; send SMS check-in + queue Care Coordinator human callback within 2h.',
      clinicalNurseAlert: false,
      modelUsed: 'clinical-rules-fallback',
    };
  }

  // Accessibility / Acute clinical or mobility check first
  if (
    /\b(fever|breath|dyspnea|oxygen|wheelchair|stairs|walk|mobility|weak|frail|dizzy|nausea|bleed|symptom|sick|pain|accessible)\b/.test(
      lower
    )
  ) {
    return {
      aiReply: `Thank you for telling me right away, ${patient.name}. We are NOT cancelling your ${patient.appointmentType}—your slot stays protected, and I am triggering an oncology nurse & accessibility callback from ${patient.hubHospital} to arrange safe medical transport or Kotisairaala support.`,
      outcome: 'declined_classified',
      needsProbe: false,
      barrierCategory: 'Accessibility',
      barrierSummary: 'Mobility, frailty, or acute symptom accessibility barrier flagged.',
      recommendedAction:
        'Hold Goal 3 fast-track slot; trigger urgent oncology nurse triage + wheelchair/escort medical transport.',
      clinicalNurseAlert: true,
      modelUsed: 'clinical-rules-fallback',
    };
  }

  // Weather
  if (/\b(storm|blizzard|snow|ice|icy|freeze|freezing|weather|road closed|slippery)\b/.test(lower)) {
    return {
      aiReply: `I completely understand—severe winter conditions near ${patient.municipality} make travel unsafe. We are keeping your ${patient.pathwayStage} slot held and queuing a human Care Coordinator to arrange 4WD Kela winter transport or re-time within the Goal 3 target window.`,
      outcome: 'declined_classified',
      needsProbe: false,
      barrierCategory: 'Weather',
      barrierSummary: `Severe winter weather barrier affecting transit from ${patient.municipality}.`,
      recommendedAction:
        'Activate severe-weather contingency: hold fast-track slot + arrange 4WD Kela medical taxi or coordinator reschedule.',
      clinicalNurseAlert: false,
      modelUsed: 'clinical-rules-fallback',
    };
  }

  // Transport
  if (
    /\b(bus|train|taxi|car|drive|km|distance|transport|ride|far|travel|shuttle|afford|money|cost|co-pay|copay|voucher|oulu|lapland)\b/.test(
      lower
    )
  ) {
    return {
      aiReply: `Thank you for letting us know, ${patient.name}—traveling ${patient.distanceKm} km from ${patient.municipality} without available transport is a known rural barrier. Your ${patient.appointmentType} is NOT cancelled; I am logging Transport, flagging Goal 3 delay protection, and queuing a Care Coordinator to issue a Kela travel voucher or Shared Medical Shuttle seat.`,
      outcome: 'declined_classified',
      needsProbe: false,
      barrierCategory: 'Transport',
      barrierSummary: `Rural transit / ${patient.distanceKm} km transport unavailable from ${patient.municipality}.`,
      recommendedAction:
        'Hold diagnostic fast-track slot; issue upfront Kela medical taxi voucher or Shared Regional Medical Shuttle pickup + Care Coordinator callback.',
      clinicalNurseAlert: false,
      modelUsed: 'clinical-rules-fallback',
    };
  }

  // Scheduling
  if (/\b(work|shift|job|boss|employer|schedule|time|child|caregiver|busy|hour|morning)\b/.test(lower)) {
    return {
      aiReply: `Understood, ${patient.name}. We are holding your referral active and queuing a Care Coordinator (nimetty työntekijä) to move you into a flexible afternoon or bundled diagnostic slot under TYÖOTE protection.`,
      outcome: 'declined_classified',
      needsProbe: false,
      barrierCategory: 'Scheduling',
      barrierSummary: 'Work-shift or daytime scheduling conflict.',
      recommendedAction:
        'Hold Goal 3 fast-track referral; move to flexible evening/bundled clinic slot + issue TYÖOTE leave certificate.',
      clinicalNurseAlert: false,
      modelUsed: 'clinical-rules-fallback',
    };
  }

  // Language
  if (
    /\b(language|understand|finnish|swedish|translate|interpreter|letter|confused|afraid|scared|instruction)\b/.test(
      lower
    )
  ) {
    return {
      aiReply: `Thank you for sharing that, ${patient.name}. Your appointment remains held, and I am assigning a Care Coordinator with a certified ${patient.primaryLanguage} medical interpreter to call you back and walk through every step clearly.`,
      outcome: 'declined_classified',
      needsProbe: false,
      barrierCategory: 'Language',
      barrierSummary: `${patient.primaryLanguage} language or preparation instruction comprehension barrier.`,
      recommendedAction: `Hold appointment; assign Care Coordinator (nimetty työntekijä) + certified ${patient.primaryLanguage} interpreter callback.`,
      clinicalNurseAlert: false,
      modelUsed: 'clinical-rules-fallback',
    };
  }

  // Confirmations
  if (
    /\b(yes|yeah|yep|confirm|attending|i will be there|i can make it|coming|see you|ok|okay|kyllä|joo)\b/.test(
      lower
    ) &&
    !/\b(can't|cannot|won't|not|no)\b/.test(lower)
  ) {
    return {
      aiReply: `Wonderful, thank you for confirming, ${patient.name}. Your ${patient.appointmentType} (${patient.appointmentTimeLabel}) is locked within Goal 3 target timelines.`,
      outcome: 'confirmed',
      needsProbe: false,
      barrierCategory: null,
      barrierSummary: 'Patient verbally confirmed attendance.',
      recommendedAction:
        patient.distanceKm >= 120
          ? 'Confirm Kela travel reimbursement eligibility via SMS reminder.'
          : 'Standard digital check-in active; on track for Goal 3 target.',
      clinicalNurseAlert: false,
      modelUsed: 'clinical-rules-fallback',
    };
  }

  // Vague refusal -> MUST PROBE
  const alreadyProbed = transcript.some((line) => line.probing);
  if (
    /\b(can't|cannot|won't|cancel|not coming|miss|skip|unable|don't think|maybe not)\b/.test(lower) ||
    !alreadyProbed
  ) {
    return {
      aiReply: `I understand, ${patient.name}, and I will NOT cancel your ${patient.appointmentType}. Before we wrap up, could you tell me what is making it hard to attend—is it transport from ${patient.municipality}, winter weather, scheduling/work, physical accessibility, or unclear instructions?`,
      outcome: 'continue_probe',
      needsProbe: true,
      barrierCategory: null,
      barrierSummary: null,
      recommendedAction: null,
      clinicalNurseAlert: false,
      modelUsed: 'clinical-rules-fallback',
    };
  }

  return {
    aiReply: `Thank you for explaining, ${patient.name}. Your fast-track appointment remains protected, and a human Care Coordinator at ${patient.hubHospital} will call you back today.`,
    outcome: 'declined_classified',
    needsProbe: false,
    barrierCategory: 'Other',
    barrierSummary: latestText.trim(),
    recommendedAction:
      'Hold fast-track appointment; queue human Care Coordinator (nimetty työntekijä) callback within 4h.',
    clinicalNurseAlert: false,
    modelUsed: 'clinical-rules-fallback',
  };
}

function normalizeCategory(raw: unknown): BarrierCategory {
  const valid: BarrierCategory[] = [
    'Transport',
    'Weather',
    'Scheduling',
    'Accessibility',
    'Language',
    'Other',
  ];
  if (typeof raw !== 'string') return 'Other';
  const lower = raw.trim().toLowerCase();
  const exact = valid.find((v) => v.toLowerCase() === lower);
  if (exact) return exact;
  if (/transport|distance|travel|bus|taxi|cost|money/.test(lower)) return 'Transport';
  if (/weather|snow|storm|ice/.test(lower)) return 'Weather';
  if (/schedul|time|work|shift/.test(lower)) return 'Scheduling';
  if (/access|mobil|frail|symptom|fever|wheelchair/.test(lower)) return 'Accessibility';
  if (/lang|interpret|fear|confus/.test(lower)) return 'Language';
  return 'Other';
}

async function runGeminiCallTurn(
  patient: PatientContextPayload,
  transcript: TranscriptLine[],
  latestPatientText: string,
  mode: 'turn' | 'finalize'
): Promise<CallTurnApiResponse> {
  if (!process.env.GEMINI_API_KEY) {
    return deterministicFallbackTurn(patient, transcript, latestPatientText);
  }

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
      ? ' Finalize and classify the full call transcript now. Never cancel the appointment.'
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

  let modelUsed = 'gemini-3.8-flash';
  try {
    let response;
    try {
      response = await callModel(modelUsed);
    } catch (primaryErr) {
      const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      if (/404|NOT_FOUND|not found|unsupported/i.test(msg)) {
        modelUsed = 'gemini-4-hydrogen';
        response = await callModel(modelUsed);
      } else {
        throw primaryErr;
      }
    }

    const parsed = JSON.parse((response.text ?? '{}').trim()) as Partial<CallTurnApiResponse>;
    const outcome =
      parsed.outcome === 'confirmed' ||
      parsed.outcome === 'declined_classified' ||
      parsed.outcome === 'no_answer' ||
      parsed.outcome === 'continue_probe'
        ? parsed.outcome
        : 'continue_probe';

    return {
      aiReply:
        parsed.aiReply ||
        'Your appointment stays held—could you share which barrier is making it hard to attend?',
      outcome,
      needsProbe: outcome === 'continue_probe' ? true : Boolean(parsed.needsProbe),
      barrierCategory:
        outcome === 'declined_classified' ? normalizeCategory(parsed.barrierCategory) : null,
      barrierSummary: parsed.barrierSummary ?? null,
      recommendedAction: parsed.recommendedAction ?? null,
      clinicalNurseAlert: Boolean(parsed.clinicalNurseAlert),
      modelUsed,
    };
  } catch (err) {
    console.warn('Gemini call-turn failed, using clinical rules fallback:', err);
    return deterministicFallbackTurn(patient, transcript, latestPatientText);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'fican-careconnect-lung-pathway',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  app.post('/api/call-turn', async (req, res) => {
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
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/classify-call', async (req, res) => {
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
      res.status(500).json({ error: message });
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
        };

        if (msg.type === 'start' && msg.patient) {
          if (!process.env.GEMINI_API_KEY) {
            safeSend({
              type: 'fallback',
              reason: 'GEMINI_API_KEY missing; using Web Speech + structured turn engine.',
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
            `Greet ${p.name} warmly, confirm their ${p.appointmentType}, and never cancel their slot if they report a barrier.`;

          try {
            const session = await ai.live.connect({
              model: 'gemini-3.8-live',
              config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: 'Zephyr' },
                  },
                },
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                systemInstruction: liveSystemInstruction,
              },
              callbacks: {
                onopen: () => {
                  safeSend({ type: 'ready', model: 'gemini-3.8-live' });
                },
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
                onerror: (err) => {
                  console.warn('Gemini Live session error:', err);
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

            liveSession = session as unknown as {
              sendRealtimeInput: (input: Record<string, unknown>) => void;
              close: () => void;
            };

            liveSession.sendRealtimeInput({
              text: `The outbound call connected to ${p.name}. Greet them now and confirm their ${p.appointmentType}.`,
            });
          } catch (connectErr) {
            console.warn('Failed to open gemini-3.8-live session:', connectErr);
            safeSend({
              type: 'fallback',
              reason: 'gemini-3.8-live unavailable; using Web Speech + Flash turn engine.',
            });
          }
          return;
        }

        if (msg.type === 'audio' && msg.data && liveSession) {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: 'audio/pcm;rate=16000',
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
