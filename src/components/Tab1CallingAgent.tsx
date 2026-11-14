import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneOff,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  UserCheck,
  Volume2,
} from 'lucide-react';
import { FOCUS_REGIONS, FOCUS_REGION_ORDER } from '../data/patients.ts';
import type {
  BarrierCategory,
  CallStatus,
  CallTurnApiResponse,
  FocusRegionId,
  PathwayStage,
  PatientRecord,
  RiskTier,
  TranscriptLine,
} from '../types/careconnect.ts';
import { BARRIER_CATEGORIES, getTierMeta, RISK_TIERS } from '../utils/riskEngine.ts';
import { float32ToPcm16Base64, voiceAudio } from '../utils/voiceAudio.ts';

interface Tab1CallingAgentProps {
  patients: PatientRecord[];
  selectedPatientId: string;
  activeCallPatientId: string | null;
  recentlyUpdatedId: string | null;
  onSelectPatient: (patientId: string) => void;
  onStartCall: (patientId: string) => void;
  onEndCall: () => void;
  onAppendTranscript: (patientId: string, line: TranscriptLine) => void;
  onApplyOutcome: (
    patientId: string,
    outcome: {
      callStatus: CallStatus;
      barrierCategory?: BarrierCategory | null;
      barrierSummary?: string | null;
      recommendedAction?: string | null;
      clinicalNurseAlert?: boolean;
      overriddenByHuman?: boolean;
      humanCoordinatorRequested?: boolean;
    }
  ) => void;
  onOverrideBarrier: (patientId: string, newBarrier: BarrierCategory) => void;
  onRequestHumanCoordinator: (patientId: string) => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const SIMULATED_REPLIES: Array<{
  id: string;
  label: string;
  tone: 'confirm' | 'probe' | 'barrier' | 'urgent' | 'no_answer';
  utterance: string;
}> = [
  {
    id: 'confirm',
    label: 'Confirm Attendance',
    tone: 'confirm',
    utterance: 'Yes, thank you. I will attend my scheduled lung pathway appointment.',
  },
  {
    id: 'vague',
    label: 'Vague Refusal (Triggers Probing)',
    tone: 'probe',
    utterance: "I can't make it to the CT biopsy tomorrow, I need to cancel.",
  },
  {
    id: 'transport',
    label: 'Transport Unavailable (>400 km)',
    tone: 'barrier',
    utterance:
      'There is no bus or rural transport available from Inari to Oulu in time for the morning CT biopsy.',
  },
  {
    id: 'weather',
    label: 'Severe Winter Weather',
    tone: 'barrier',
    utterance:
      'A heavy winter snowstorm closed our side road and driving is unsafe right now.',
  },
  {
    id: 'scheduling',
    label: 'Scheduling / Work Shift',
    tone: 'barrier',
    utterance:
      'My morning work shift supervisor will not release me unless we move it to afternoon.',
  },
  {
    id: 'accessibility',
    label: 'Accessibility / Dyspnea (Nurse Alert)',
    tone: 'urgent',
    utterance:
      'I am short of breath, dizzy, and need a wheelchair escort—I cannot walk to the transit stop.',
  },
  {
    id: 'language',
    label: 'Language / Prep Confusion',
    tone: 'barrier',
    utterance:
      'I did not understand the Finnish preparation instructions and need an interpreter.',
  },
  {
    id: 'no_answer',
    label: 'No Answer / Voicemail',
    tone: 'no_answer',
    utterance: '[NO_ANSWER_VOICEMAIL]',
  },
];

function nowTime(): string {
  return new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function microphoneErrorMessage(error: unknown): string {
  if (!window.isSecureContext) {
    return 'Microphone access requires a secure page. Open http://localhost:3000 instead of the WSL IP address.';
  }
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Microphone permission is blocked. Allow microphone access for localhost in the browser site settings, reload, and try again.';
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'No microphone was found. Connect or enable a microphone, then try again.';
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return 'The microphone is being used by another application. Close the other application and try again.';
    }
  }
  return 'The browser could not start the microphone. Check the site microphone permission and try again.';
}

function speechRecognitionErrorMessage(error?: string): string {
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return 'Microphone permission is blocked. Allow it for localhost, reload, and try again.';
  }
  if (error === 'audio-capture') return 'No working microphone was detected.';
  if (error === 'network') {
    return 'Browser speech recognition is unavailable. Type your reply below instead.';
  }
  return 'Browser speech recognition stopped. Type your reply below or retry the microphone.';
}

export const Tab1CallingAgent: React.FC<Tab1CallingAgentProps> = ({
  patients,
  selectedPatientId,
  activeCallPatientId,
  recentlyUpdatedId,
  onSelectPatient,
  onStartCall,
  onEndCall,
  onAppendTranscript,
  onApplyOutcome,
  onOverrideBarrier,
  onRequestHumanCoordinator,
}) => {
  const [regionFilter, setRegionFilter] = useState<FocusRegionId | 'ALL'>('ALL');
  const [stageFilter, setStageFilter] = useState<PathwayStage | 'ALL'>('ALL');
  const [tierFilter, setTierFilter] = useState<RiskTier | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<CallStatus | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(true);
  const detailsPanelRef = useRef<HTMLElement | null>(null);

  const [voiceMode, setVoiceMode] = useState<'idle' | 'gemini-live' | 'web-speech' | 'guided'>(
    'idle'
  );
  const [statusNote, setStatusNote] = useState<string>(
    'Select a Lung Cancer Fast-Track patient and initiate AI outreach.'
  );
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isProcessingTurn, setIsProcessingTurn] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [manualInput, setManualInput] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micProcRef = useRef<ScriptProcessorNode | null>(null);
  const micSendEnabledRef = useRef(false);
  const speechRecRef = useRef<SpeechRecognitionInstance | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const patient = useMemo(
    () => patients.find((p) => p.id === selectedPatientId) ?? patients[0],
    [patients, selectedPatientId]
  );

  const isLiveCalling = activeCallPatientId === patient.id;
  const activePatientRef = useRef(patient);
  activePatientRef.current = patient;
  const isLiveRef = useRef(isLiveCalling);
  isLiveRef.current = isLiveCalling;

  const liveAiBufferRef = useRef('');
  const liveUserBufferRef = useRef('');
  const pendingTypedLiveLineRef = useRef<TranscriptLine | null>(null);

  const filteredQueue = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return patients
      .filter((p) => (regionFilter === 'ALL' ? true : p.regionId === regionFilter))
      .filter((p) => (stageFilter === 'ALL' ? true : p.pathwayStage === stageFilter))
      .filter((p) => (tierFilter === 'ALL' ? true : p.riskTier === tierFilter))
      .filter((p) => (statusFilter === 'ALL' ? true : p.callStatus === statusFilter))
      .filter((p) =>
        q
          ? p.name.toLowerCase().includes(q) ||
            p.municipality.toLowerCase().includes(q) ||
            p.id.toLowerCase().includes(q) ||
            p.appointmentType.toLowerCase().includes(q)
          : true
      )
      .sort((a, b) => b.riskScore - a.riskScore);
  }, [patients, regionFilter, stageFilter, tierFilter, statusFilter, searchQuery]);

  useEffect(() => {
    if (detailsOpen) {
      transcriptEndRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [detailsOpen, patient.transcript.length]);

  const cleanupMediaAndSockets = () => {
    micSendEnabledRef.current = false;
    pendingTypedLiveLineRef.current = null;
    if (micProcRef.current) {
      try {
        micProcRef.current.disconnect();
      } catch {
        // noop
      }
      micProcRef.current = null;
    }
    if (micCtxRef.current) {
      try {
        void micCtxRef.current.close();
      } catch {
        // noop
      }
      micCtxRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {
        // noop
      }
      speechRecRef.current = null;
    }
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'stop' }));
        }
        wsRef.current.close();
      } catch {
        // noop
      }
      wsRef.current = null;
    }
    voiceAudio.stopLivePlayback();
    voiceAudio.stopSpeech();
    setMicActive(false);
    setIsAiSpeaking(false);
  };

  useEffect(() => {
    return () => {
      cleanupMediaAndSockets();
    };
  }, []);

  useEffect(() => {
    if (!isLiveCalling && voiceMode !== 'idle') {
      cleanupMediaAndSockets();
      setVoiceMode('idle');
    }
  }, [isLiveCalling, voiceMode]);

  const speakGreeting = (target: PatientRecord) => {
    const region = FOCUS_REGIONS[target.regionId];
    const greeting =
      `Hello ${target.name}, this is the FICAN Care Coordinator from ${region.hubHospital}. ` +
      `I am calling to confirm your Lung Pathway ${target.pathwayStage} appointment (${target.appointmentType}, ${target.appointmentTimeLabel}). ` +
      `Can you attend as planned, or is there a transport, weather, scheduling, or health barrier we can solve together?`;

    onAppendTranscript(target.id, {
      id: `ai-greet-${Date.now()}`,
      speaker: 'AI Coordinator',
      text: greeting,
      timestamp: nowTime(),
    });
    setIsAiSpeaking(true);
    voiceAudio.speakText(greeting);
    window.setTimeout(() => setIsAiSpeaking(false), 3200);
  };

  const classifyCompletedLiveTurn = async (
    target: PatientRecord,
    transcript: TranscriptLine[],
    latestPatientText: string
  ) => {
    setIsProcessingTurn(true);
    try {
      const region = FOCUS_REGIONS[target.regionId];
      const response = await fetch('/api/classify-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient: {
            id: target.id,
            name: target.name,
            age: target.age,
            municipality: target.municipality,
            regionId: target.regionId,
            hubHospital: region.hubHospital,
            distanceKm: target.distanceKm,
            pathwayStage: target.pathwayStage,
            cancerDiagnosis: target.cancerDiagnosis,
            cancerStage: target.cancerStage,
            primaryLanguage: target.primaryLanguage,
            appointmentType: target.appointmentType,
            appointmentTimeLabel: target.appointmentTimeLabel,
          },
          transcript,
          summaryText: latestPatientText,
        }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(failure.error || 'Gemini could not classify the completed turn.');
      }
      const data = (await response.json()) as CallTurnApiResponse;
      if (data.outcome === 'cancellation_reason_requested') {
        setStatusNote('Cancellation requested — waiting for the patient’s reason.');
      } else if (data.outcome === 'cancelled') {
        onApplyOutcome(target.id, {
          callStatus: 'Appointment Cancelled',
          barrierCategory: data.barrierCategory ?? 'Other',
          barrierSummary: data.barrierSummary ?? latestPatientText,
          recommendedAction: data.recommendedAction,
          clinicalNurseAlert: data.clinicalNurseAlert,
          humanCoordinatorRequested: true,
        });
        setStatusNote('Appointment cancelled after the reason was requested.');
        cleanupMediaAndSockets();
        setVoiceMode('idle');
        onEndCall();
      }
    } catch (error) {
      setStatusNote(
        error instanceof Error ? error.message : 'Gemini could not classify the completed turn.'
      );
    } finally {
      setIsProcessingTurn(false);
    }
  };

  const evaluateTurnWithBackend = async (
    targetPatient: PatientRecord,
    patientUtterance: string
  ) => {
    if (patientUtterance === '[NO_ANSWER_VOICEMAIL]') {
      onAppendTranscript(targetPatient.id, {
        id: `sys-noans-${Date.now()}`,
        speaker: 'System',
        text: 'Outbound call unanswered -> Appointment HELD (never auto-cancelled). Risk increased +14 pts and Care Coordinator callback queued.',
        timestamp: nowTime(),
      });
      onApplyOutcome(targetPatient.id, {
        callStatus: 'No Pick-Up',
        barrierCategory: null,
        barrierSummary: 'Call unanswered / voicemail reached.',
        recommendedAction:
          'Keep Goal 3 fast-track slot held; queue human Care Coordinator (nimetty työntekijä) callback within 2h.',
        clinicalNurseAlert: false,
        humanCoordinatorRequested: true,
      });
      voiceAudio.playOutcomeTone('escalated');
      setStatusNote('No Pick-Up logged · Slot protected · Human callback queued.');
      cleanupMediaAndSockets();
      setVoiceMode('idle');
      onEndCall();
      return;
    }

    const updatedLine: TranscriptLine = {
      id: `pat-${Date.now()}`,
      speaker: 'Patient',
      text: patientUtterance,
      timestamp: nowTime(),
    };
    onAppendTranscript(targetPatient.id, updatedLine);
    setIsProcessingTurn(true);

    try {
      const region = FOCUS_REGIONS[targetPatient.regionId];
      const resp = await fetch('/api/call-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient: {
            id: targetPatient.id,
            name: targetPatient.name,
            age: targetPatient.age,
            municipality: targetPatient.municipality,
            regionId: targetPatient.regionId,
            hubHospital: region.hubHospital,
            distanceKm: targetPatient.distanceKm,
            pathwayStage: targetPatient.pathwayStage,
            cancerDiagnosis: targetPatient.cancerDiagnosis,
            cancerStage: targetPatient.cancerStage,
            primaryLanguage: targetPatient.primaryLanguage,
            appointmentType: targetPatient.appointmentType,
            appointmentTimeLabel: targetPatient.appointmentTimeLabel,
          },
          transcript: [...targetPatient.transcript, updatedLine],
          latestText: patientUtterance,
        }),
      });

      if (!resp.ok) {
        const failure = await resp.json().catch(() => ({}));
        throw new Error(failure.error || 'Gemini could not respond. Please try again.');
      }
      const data = (await resp.json()) as CallTurnApiResponse;

      onAppendTranscript(targetPatient.id, {
        id: `ai-${Date.now()}`,
        speaker: 'AI Coordinator',
        text: data.aiReply,
        timestamp: nowTime(),
        probing: data.needsProbe,
      });

      setIsAiSpeaking(true);
      voiceAudio.speakText(data.aiReply);
      window.setTimeout(() => setIsAiSpeaking(false), 3000);

      if (data.outcome === 'cancellation_reason_requested') {
        setStatusNote('Cancellation requested — tell Gemini the reason to complete it.');
      } else if (data.outcome === 'continue_probe') {
        setStatusNote('Gemini is asking one follow-up question.');
      } else if (data.outcome === 'cancelled') {
        onApplyOutcome(targetPatient.id, {
          callStatus: 'Appointment Cancelled',
          barrierCategory: data.barrierCategory ?? 'Other',
          barrierSummary: data.barrierSummary ?? patientUtterance,
          recommendedAction: data.recommendedAction,
          clinicalNurseAlert: data.clinicalNurseAlert,
          humanCoordinatorRequested: true,
        });
        voiceAudio.playOutcomeTone('escalated');
        setStatusNote('Appointment cancelled after the reason was requested.');
        window.setTimeout(() => {
          cleanupMediaAndSockets();
          setVoiceMode('idle');
          onEndCall();
        }, 2600);
      } else if (data.outcome === 'confirmed') {
        onApplyOutcome(targetPatient.id, {
          callStatus: 'Confirmed Attending',
          barrierCategory: null,
          barrierSummary: data.barrierSummary ?? 'Patient confirmed attendance.',
          recommendedAction: data.recommendedAction,
          clinicalNurseAlert: false,
        });
        voiceAudio.playOutcomeTone('confirmed');
        setStatusNote('Confirmed attending. The outreach score was updated.');
        cleanupMediaAndSockets();
        setVoiceMode('idle');
        onEndCall();
      } else if (data.outcome === 'declined_classified') {
        onApplyOutcome(targetPatient.id, {
          callStatus: 'Follow-Up Required (Human Callback Queued)',
          barrierCategory: data.barrierCategory ?? 'Other',
          barrierSummary: data.barrierSummary ?? patientUtterance,
          recommendedAction: data.recommendedAction,
          clinicalNurseAlert: data.clinicalNurseAlert,
          humanCoordinatorRequested: true,
        });
        voiceAudio.playOutcomeTone(data.clinicalNurseAlert ? 'urgent' : 'escalated');
        setStatusNote(
          `Captured [${data.barrierCategory ?? 'Other'}] · Appointment held · Human Care Coordinator queued.`
        );
        cleanupMediaAndSockets();
        setVoiceMode('idle');
        onEndCall();
      }
    } catch (err) {
      setStatusNote(
        `Turn processing error: ${err instanceof Error ? err.message : 'Unable to evaluate response.'}`
      );
    } finally {
      setIsProcessingTurn(false);
    }
  };

  const startWebSpeechFallback = (target: PatientRecord) => {
    setVoiceMode('web-speech');
    speakGreeting(target);

    const SpeechRecCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance })
        .webkitSpeechRecognition;

    if (!SpeechRecCtor) {
      setStatusNote('Guided mode active — use Simulated Voice Replies or text box below.');
      setVoiceMode('guided');
      return;
    }

    try {
      const rec = new SpeechRecCtor();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'en-US';
      rec.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            const spoken = res[0].transcript.trim();
            if (spoken) {
              void evaluateTurnWithBackend(activePatientRef.current, spoken);
            }
          }
        }
      };
      rec.onerror = (event) => {
        setMicActive(false);
        setVoiceMode('guided');
        setStatusNote(speechRecognitionErrorMessage(event.error));
      };
      rec.onend = () => setMicActive(false);
      rec.start();
      speechRecRef.current = rec;
      setMicActive(true);
      setStatusNote('Web Speech Recognition listening — speak naturally or simulate reply.');
    } catch {
      setVoiceMode('guided');
      setStatusNote('Guided mode active — use Simulated Patient Voice Replies below.');
    }
  };

  const handleStartLiveMicCall = async () => {
    cleanupMediaAndSockets();
    const target = activePatientRef.current;
    setStatusNote('Checking Gemini connection…');
    try {
      const response = await fetch('/api/health');
      if (!response.ok) throw new Error('Unable to reach the Gemini server.');
      const health = await response.json();
      if (!health.geminiConfigured) throw new Error('Add GEMINI_API_KEY to the project .env file and restart the server.');
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : 'Unable to reach the Gemini server.');
      return;
    }
    setStatusNote('Connecting to Gemini Live…');

    let micStream: MediaStream | null = null;
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        micStreamRef.current = micStream;
      } else {
        throw new DOMException('getUserMedia is unavailable', 'NotSupportedError');
      }
    } catch (error) {
      setVoiceMode('idle');
      setStatusNote(microphoneErrorMessage(error));
      return;
    }

    if (!micStream) {
      setStatusNote('No active microphone stream was returned by the browser.');
      return;
    }

    onStartCall(target.id);
    voiceAudio.playDialTone();

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/live-call`);
    wsRef.current = ws;

    let switchedToFallback = false;

    ws.onopen = () => {
      const region = FOCUS_REGIONS[target.regionId];
      ws.send(
        JSON.stringify({
          type: 'start',
          patient: {
            id: target.id,
            name: target.name,
            age: target.age,
            municipality: target.municipality,
            regionId: target.regionId,
            hubHospital: region.hubHospital,
            distanceKm: target.distanceKm,
            pathwayStage: target.pathwayStage,
            cancerDiagnosis: target.cancerDiagnosis,
            cancerStage: target.cancerStage,
            primaryLanguage: target.primaryLanguage,
            appointmentType: target.appointmentType,
            appointmentTimeLabel: target.appointmentTimeLabel,
          },
        })
      );
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(String(evt.data)) as {
          type?: string;
          data?: string;
          text?: string;
          reason?: string;
        };

        if (msg.type === 'error') {
          switchedToFallback = true;
          cleanupMediaAndSockets();
          setVoiceMode('idle');
          onEndCall();
          setStatusNote(msg.reason || 'Gemini is unavailable. Check the server configuration.');
          return;
        }

        if (msg.type === 'ready') {
          setVoiceMode('gemini-live');
          micSendEnabledRef.current = true;
          setStatusNote('Gemini Live connected — you can interrupt at any time.');
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AudioCtx && micStreamRef.current) {
            const ctx = new AudioCtx();
            void ctx.resume();
            micCtxRef.current = ctx;
            const src = ctx.createMediaStreamSource(micStreamRef.current);
            const proc = ctx.createScriptProcessor(4096, 1, 1);
            micProcRef.current = proc;
            proc.onaudioprocess = (e) => {
              if (
                !micSendEnabledRef.current ||
                !wsRef.current ||
                wsRef.current.readyState !== WebSocket.OPEN
              ) return;
              const pcmBase64 = float32ToPcm16Base64(e.inputBuffer.getChannelData(0));
              wsRef.current.send(
                JSON.stringify({
                  type: 'audio',
                  data: pcmBase64,
                  sampleRate: ctx.sampleRate,
                })
              );
            };
            src.connect(proc);
            proc.connect(ctx.destination);
            setMicActive(true);
          } else {
            cleanupMediaAndSockets();
            setStatusNote('This browser does not support live microphone audio.');
          }
          return;
        }

        if (msg.type === 'audio' && msg.data) {
          setIsAiSpeaking(true);
          setStatusNote('Gemini is speaking — you can interrupt.');
          voiceAudio.enqueuePcm24k(msg.data);
          return;
        }

        if (msg.type === 'ai_transcript' && msg.text) {
          liveAiBufferRef.current += msg.text;
          return;
        }

        if (msg.type === 'user_transcript' && msg.text) {
          liveUserBufferRef.current += msg.text;
          return;
        }

        if (msg.type === 'turn_complete') {
          setIsAiSpeaking(false);
          const completedTranscript = [...activePatientRef.current.transcript];
          const pendingTypedLine = pendingTypedLiveLineRef.current;
          const liveUserText =
            liveUserBufferRef.current.trim() || pendingTypedLine?.text.trim() || '';
          const liveAiText = liveAiBufferRef.current.trim();
          if (liveUserBufferRef.current.trim()) {
            const patientLine: TranscriptLine = {
              id: `pat-live-${Date.now()}`,
              speaker: 'Patient',
              text: liveUserText,
              timestamp: nowTime(),
            };
            completedTranscript.push(patientLine);
            onAppendTranscript(activePatientRef.current.id, patientLine);
            liveUserBufferRef.current = '';
          } else if (
            pendingTypedLine &&
            !completedTranscript.some((line) => line.id === pendingTypedLine.id)
          ) {
            completedTranscript.push(pendingTypedLine);
          }
          pendingTypedLiveLineRef.current = null;
          if (liveAiText) {
            const aiLine: TranscriptLine = {
              id: `ai-live-${Date.now()}`,
              speaker: 'AI Coordinator',
              text: liveAiText,
              timestamp: nowTime(),
            };
            completedTranscript.push(aiLine);
            onAppendTranscript(activePatientRef.current.id, aiLine);
            liveAiBufferRef.current = '';
          }
          micSendEnabledRef.current = true;
          setStatusNote('Listening — speak now or interrupt the next response.');
          if (liveUserText) {
            void classifyCompletedLiveTurn(
              activePatientRef.current,
              completedTranscript,
              liveUserText
            );
          }
          return;
        }

        if (msg.type === 'interrupted') {
          voiceAudio.stopLivePlayback();
          setIsAiSpeaking(false);
          micSendEnabledRef.current = true;
          setStatusNote('Listening — speak now.');
          return;
        }

        if (msg.type === 'fallback') {
          switchedToFallback = true;
          cleanupMediaAndSockets();
          startWebSpeechFallback(activePatientRef.current);
        }
      } catch {
        // noop
      }
    };

    ws.onerror = () => {
      if (!switchedToFallback) {
        switchedToFallback = true;
        cleanupMediaAndSockets();
        startWebSpeechFallback(activePatientRef.current);
      }
    };

    ws.onclose = () => {
      if (!switchedToFallback && isLiveRef.current && voiceMode === 'gemini-live') {
        setMicActive(false);
      }
    };
  };

  const handleStartGuidedCall = () => {
    cleanupMediaAndSockets();
    const target = activePatientRef.current;
    onStartCall(target.id);
    setVoiceMode('guided');
    voiceAudio.playDialTone();
    setStatusNote('AI Outreach Call live — click a Simulated Patient Reply or type response.');
    speakGreeting(target);
  };

  const handleHangUpAndClassify = async () => {
    const target = activePatientRef.current;
    const hadPatientLines = target.transcript.some((t) => t.speaker === 'Patient');
    let completionNote = 'Call finished.';

    if (voiceMode === 'gemini-live' && hadPatientLines) {
      setIsProcessingTurn(true);
      try {
        const region = FOCUS_REGIONS[target.regionId];
        const resp = await fetch('/api/classify-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patient: {
              id: target.id,
              name: target.name,
              age: target.age,
              municipality: target.municipality,
              regionId: target.regionId,
              hubHospital: region.hubHospital,
              distanceKm: target.distanceKm,
              pathwayStage: target.pathwayStage,
              cancerDiagnosis: target.cancerDiagnosis,
              cancerStage: target.cancerStage,
              primaryLanguage: target.primaryLanguage,
              appointmentType: target.appointmentType,
              appointmentTimeLabel: target.appointmentTimeLabel,
            },
            transcript: target.transcript,
          }),
        });
        if (!resp.ok) {
          const failure = await resp.json().catch(() => ({}));
          throw new Error(failure.error || 'Gemini could not summarize the call.');
        }
        if (resp.ok) {
          const data = (await resp.json()) as CallTurnApiResponse;
          if (data.outcome === 'cancelled') {
            onApplyOutcome(target.id, {
              callStatus: 'Appointment Cancelled',
              barrierCategory: data.barrierCategory ?? 'Other',
              barrierSummary: data.barrierSummary,
              recommendedAction: data.recommendedAction,
              clinicalNurseAlert: data.clinicalNurseAlert,
              humanCoordinatorRequested: true,
            });
            completionNote = 'Appointment cancelled after the reason was requested.';
          } else if (data.outcome === 'confirmed') {
            onApplyOutcome(target.id, {
              callStatus: 'Confirmed Attending',
              barrierSummary: data.barrierSummary,
              recommendedAction: data.recommendedAction,
            });
          } else if (data.outcome === 'declined_classified') {
            onApplyOutcome(target.id, {
              callStatus: 'Follow-Up Required (Human Callback Queued)',
              barrierCategory: data.barrierCategory ?? 'Other',
              barrierSummary: data.barrierSummary,
              recommendedAction: data.recommendedAction,
              clinicalNurseAlert: data.clinicalNurseAlert,
              humanCoordinatorRequested: true,
            });
          }
        }
      } catch (error) {
        completionNote = error instanceof Error ? error.message : 'Gemini could not summarize the call.';
      } finally {
        setIsProcessingTurn(false);
      }
    }

    cleanupMediaAndSockets();
    setVoiceMode('idle');
    onEndCall();
    setStatusNote(completionNote);
  };

  const handleSimulatedReply = async (utterance: string) => {
    const target = activePatientRef.current;
    if (!isLiveCalling) {
      onStartCall(target.id);
      setVoiceMode('guided');
      if (target.transcript.length === 0 && utterance !== '[NO_ANSWER_VOICEMAIL]') {
        speakGreeting(target);
      }
    }
    await evaluateTurnWithBackend(activePatientRef.current, utterance);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualInput.trim();
    if (!trimmed) return;
    setManualInput('');
    if (voiceMode === 'gemini-live' && wsRef.current?.readyState === WebSocket.OPEN) {
      const typedLine: TranscriptLine = {
        id: `pat-txt-${Date.now()}`,
        speaker: 'Patient',
        text: trimmed,
        timestamp: nowTime(),
      };
      pendingTypedLiveLineRef.current = typedLine;
      onAppendTranscript(patient.id, typedLine);
      micSendEnabledRef.current = false;
      wsRef.current.send(JSON.stringify({ type: 'text', text: trimmed }));
      return;
    }
    if (!isLiveCalling) {
      onStartCall(patient.id);
      setVoiceMode('guided');
      if (patient.transcript.length === 0) {
        speakGreeting(patient);
      }
    }
    await evaluateTurnWithBackend(activePatientRef.current, trimmed);
  };

  const tierMeta = getTierMeta(patient.riskTier);
  const regionMeta = FOCUS_REGIONS[patient.regionId];
  const waveActive = isLiveCalling || isAiSpeaking || micActive;
  const { riskBreakdown } = patient;
  const riskFactors = [
    ['Care step and cancer stage', riskBreakdown.pathwayUrgencyPoints, patient.pathwayStage + ' and recorded cancer stage (' + patient.cancerStage + ').'],
    ['Age and G8 screening', riskBreakdown.ageFrailtyPoints, 'Age ' + patient.age + ' and G8 score ' + patient.g8FrailtyScore + '/17. The model gives more points for older age bands and lower G8 scores.'],
    ['Travel distance', riskBreakdown.distanceWeatherPoints, patient.distanceKm + ' km to the assigned care hub in this scenario. Points use distance bands.'],
    ['Access support', riskBreakdown.equityLanguagePoints, 'Recorded language barrier, financial vulnerability, or accessibility need.'],
    ['Missed calls and time remaining', riskBreakdown.historyMissedPoints, patient.priorMissedCalls + ' prior missed calls recorded. Points also increase when the booking is close to or past the target.'],
  ] as const;

  function togglePatientDetails(patientId: string) {
    if (detailsOpen && patientId === patient.id) {
      setDetailsOpen(false);
      return;
    }
    onSelectPatient(patientId);
    setDetailsOpen(true);
    if (!window.matchMedia('(min-width: 1024px)').matches) {
      requestAnimationFrame(() => detailsPanelRef.current?.scrollIntoView({ block: 'start' }));
    }
  }

  return (
    <div className={`grid grid-cols-1 gap-4 items-start ${detailsOpen ? 'lg:grid-cols-[44fr_56fr]' : ''}`}>
      {/* Left: Filterable Lung Cancer Fast-Track Triage Queue */}
      <section className={`min-w-0 bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden shadow-2xs ${detailsOpen ? 'max-h-[420px] lg:max-h-none lg:h-[700px]' : ''}`}>
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Lung Cancer Fast-Track Queue
              </h2>
              <p className="text-[11px] text-slate-500">
                Showing {filteredQueue.length} of {patients.length} patients across 3 focus regions
              </p>
            </div>
          </div>

          <div className={`grid grid-cols-2 gap-1.5 ${detailsOpen ? '' : 'md:grid-cols-6'}`}>
            <div className="relative col-span-2">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search patient, municipality, or ID..."
                className="w-full bg-white border border-slate-300 rounded pl-8 pr-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-600"
              />
            </div>

            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value as FocusRegionId | 'ALL')}
              aria-label="Filter queue by region"
              className="bg-white border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-sky-600"
            >
              <option value="ALL">All 3 Focus Regions</option>
              {FOCUS_REGION_ORDER.map((id) => (
                <option key={id} value={id}>
                  {FOCUS_REGIONS[id].shortLabel}
                </option>
              ))}
            </select>

            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value as PathwayStage | 'ALL')}
              aria-label="Filter queue by pathway stage"
              className="bg-white border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-sky-600"
            >
              <option value="ALL">Stage: All Pathway</option>
              <option value="Referral">Referral</option>
              <option value="Diagnostic Workup">Diagnostic Workup</option>
              <option value="Treatment Initiation">Treatment Initiation</option>
            </select>

            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as RiskTier | 'ALL')}
              aria-label="Filter queue by risk tier"
              className="bg-white border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-sky-600"
            >
              <option value="ALL">Risk: All Tiers</option>
              {RISK_TIERS.map((t) => (
                <option key={t.tier} value={t.tier}>
                  {t.tier} ({t.min}–{t.max})
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CallStatus | 'ALL')}
              aria-label="Filter queue by call status"
              className="bg-white border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-sky-600"
            >
              <option value="ALL">Status: All</option>
              <option value="Pending Call">Pending Call</option>
              <option value="Follow-Up Required (Human Callback Queued)">Follow-Up Required</option>
              <option value="Confirmed Attending">Confirmed Attending</option>
              <option value="Appointment Cancelled">Appointment Cancelled</option>
              <option value="No Pick-Up">No Pick-Up</option>
            </select>
          </div>
        </div>

        <div className={`flex-1 min-h-0 divide-y divide-slate-200 ${detailsOpen ? 'overflow-y-auto clinical-scroll' : ''}`}>
          {filteredQueue.map((p) => {
            const isExpanded = detailsOpen && p.id === patient.id;
            const isRecent = p.id === recentlyUpdatedId;
            const tMeta = getTierMeta(p.riskTier);

            return (
              <button
                key={p.id}
                type="button"
                aria-expanded={isExpanded}
                aria-controls="selected-patient-panel"
                onClick={() => togglePatientDetails(p.id)}
                className={`w-full text-left px-4 py-2.5 transition-colors cursor-pointer ${
                  isRecent
                    ? 'bg-sky-50'
                    : isExpanded
                      ? 'bg-sky-50/80 ring-1 ring-inset ring-sky-200'
                      : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className={`min-w-0 ${detailsOpen ? '' : 'flex-1 sm:grid sm:grid-cols-[1fr_1.3fr_1.5fr] sm:items-center sm:gap-3'}`}>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-900 truncate">
                        {p.name}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">{p.age}y</span>
                      {p.clinicalNurseAlert && (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                      )}
                    </div>
                    <div className="text-[11px] text-slate-600 truncate mt-0.5">
                      {FOCUS_REGIONS[p.regionId].shortLabel} · {p.municipality} (
                      <span className="font-mono tabular-nums">{p.distanceKm} km</span>)
                    </div>
                    <div className="text-[11px] text-slate-700 truncate mt-0.5">
                      {p.pathwayStage} · {p.appointmentType}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 text-right">
                    <div>
                      <div className="flex items-center justify-end gap-1 font-mono tabular-nums">
                        <span className="text-sm font-bold text-slate-900">{p.riskScore}</span>
                        {p.scoreDelta !== 0 && (
                          <span
                            className={`text-[11px] font-semibold ${
                              p.scoreDelta > 0 ? 'text-red-600' : 'text-emerald-700'
                            }`}
                          >
                            {p.scoreDelta > 0 ? `+${p.scoreDelta}` : p.scoreDelta}
                          </span>
                        )}
                      </div>
                      <span
                        className={`inline-block mt-0.5 px-1.5 py-0.5 rounded border text-[10px] font-medium ${tMeta.badgeClasses}`}
                      >
                        {p.riskTier}
                      </span>
                    </div>
                    <ChevronDown
                      aria-hidden="true"
                      className={`h-4 w-4 text-slate-500 ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  </div>
                </div>

                <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
                  <span
                    className={
                      p.callStatus === 'Confirmed Attending'
                        ? 'text-emerald-700 font-semibold'
                        : p.callStatus === 'Appointment Cancelled'
                          ? 'text-red-700 font-semibold'
                        : p.callStatus === 'Follow-Up Required (Human Callback Queued)'
                          ? 'text-amber-700 font-semibold'
                          : p.callStatus === 'No Pick-Up'
                            ? 'text-red-700 font-semibold'
                            : 'text-slate-500'
                    }
                  >
                    {p.callStatus}
                    {p.verifiedBarrier ? ` · [${p.verifiedBarrier}]` : ''}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Right: Outbound AI Voice Console + Human-in-the-Loop Safeguards */}
      <section
        ref={detailsPanelRef}
        id="selected-patient-panel"
        aria-label="Selected patient details"
        hidden={!detailsOpen}
        className={`min-w-0 scroll-mt-4 bg-white border border-slate-200 rounded-lg flex-col overflow-y-auto clinical-scroll h-[700px] shadow-2xs ${detailsOpen ? 'flex' : 'hidden'}`}
      >
        {/* Patient Clinical Header + Pathway Consequence */}
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-slate-900">{patient.name}</h2>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {patient.age}y · {patient.id}
                </span>
                {patient.clinicalNurseAlert && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-red-50 text-red-800 border border-red-200">
                    <ShieldAlert className="w-3 h-3" />
                    Nurse Triage Alert
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-600 mt-0.5">
                {regionMeta.name} · {patient.municipality} (
                <span className="font-mono tabular-nums text-sky-800 font-medium">
                  {patient.distanceKm} km
                </span>
                ) · G8 Frailty{' '}
                <span className="font-mono tabular-nums">{patient.g8FrailtyScore}/17</span> ·{' '}
                {patient.primaryLanguage}
              </p>

              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-900 font-medium">
                  Stage: {patient.pathwayStage}
                </span>
                <span aria-hidden="true" className="text-slate-400">·</span>
                <span className="text-slate-700">{patient.appointmentType}</span>
              </div>
            </div>

            <div className="shrink-0 text-right">
              <div className="flex items-center justify-end gap-1.5">
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {patient.riskScore}
                </span>
                <span className="text-xs font-mono text-slate-400">/100</span>
                {patient.scoreDelta !== 0 && (
                  <span
                    className={`text-xs font-mono tabular-nums font-semibold ${
                      patient.scoreDelta > 0 ? 'text-red-600' : 'text-emerald-700'
                    }`}
                  >
                    {patient.scoreDelta > 0 ? `+${patient.scoreDelta}` : patient.scoreDelta}
                  </span>
                )}
              </div>
              <span
                className={`inline-block mt-0.5 px-2 py-0.5 rounded border text-[11px] font-medium ${tierMeta.badgeClasses}`}
              >
                {patient.riskTier}
              </span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-200 pt-3 text-base text-black" aria-label="Appointment timing">
            {patient.callStatus === 'Appointment Cancelled' ? (
              <span className="inline-flex items-center gap-2 font-semibold text-red-700">
                <PhoneOff aria-hidden="true" className="h-4 w-4" /> Appointment cancelled
              </span>
            ) : (
              <>
                <span><strong>{patient.daysElapsed}</strong> days elapsed</span>
                <span className="inline-flex items-center gap-2"><Clock aria-hidden="true" className="h-4 w-4" />
                  {patient.daysUntilAppointment === 0 ? 'Appointment today' : patient.daysUntilAppointment > 0
                    ? <><strong>{patient.daysUntilAppointment}</strong> days until appointment</>
                    : <><strong>{Math.abs(patient.daysUntilAppointment)}</strong> days since appointment</>}
                </span>
              </>
            )}
          </div>

          <details className="mt-2 rounded-md border border-slate-200 bg-white text-xs text-slate-700">
            <summary className="cursor-pointer px-2.5 py-1.5 font-semibold text-sky-800">
              How the outreach score is calculated
            </summary>
            <div className="max-h-56 overflow-y-auto border-t border-slate-200 px-2.5 py-2">
              <p>
                The demo score ranks patients for coordinator follow-up. Baseline {patient.baselineScore}
                {patient.scoreDelta === 0
                  ? ' with no call outcome adjustment.'
                  : ' ' + (patient.scoreDelta > 0 ? '+ ' : '− ') + Math.abs(patient.scoreDelta) + ' after the call outcome = ' + patient.riskScore + '/100.'}
              </p>
              <dl className="mt-2 space-y-2">
                {riskFactors.map(([label, points, explanation]) => (
                  <div key={label}>
                    <dt className="font-semibold text-slate-900">{label} · {points} points</dt>
                    <dd>{explanation}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </details>
        </div>

        {/* Call Controls & Waveform */}
        <div className="px-4 py-2.5 border-b border-slate-200 bg-white space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {!isLiveCalling ? (
              <>
                <button
                  type="button"
                  onClick={handleStartLiveMicCall}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-700 hover:bg-sky-800 text-white font-semibold text-xs transition-colors cursor-pointer"
                >
                  <Mic className="w-3.5 h-3.5" />
                  Try a microphone conversation
                </button>
                <button
                  type="button"
                  onClick={handleStartGuidedCall}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 font-medium text-xs transition-colors cursor-pointer"
                >
                  <Phone className="w-3.5 h-3.5 text-sky-700" />
                  Start a guided simulation
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleHangUpAndClassify}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                End session and review outcome
              </button>
            )}

            <button
              type="button"
              onClick={() => onRequestHumanCoordinator(patient.id)}
              disabled={patient.humanCoordinatorRequested}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
                patient.humanCoordinatorRequested
                  ? 'bg-amber-50 border-amber-300 text-amber-900 font-semibold'
                  : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700'
              }`}
            >
              <PhoneCall className="w-3.5 h-3.5 text-amber-600" />
              {patient.humanCoordinatorRequested
                ? 'Coordinator follow-up requested'
                : 'Request coordinator follow-up'}
            </button>

            <div className="ml-auto flex items-center gap-1.5 text-[11px] font-mono text-slate-500">
              {micActive ? <Mic className="w-3.5 h-3.5 text-emerald-600" /> : <MicOff className="w-3.5 h-3.5" />}
              <span>
                {voiceMode === 'gemini-live'
                  ? 'Gemini Live'
                  : voiceMode === 'web-speech'
                    ? 'WebSpeech'
                    : voiceMode === 'guided'
                      ? 'Guided AI'
                      : 'Standby'}
              </span>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-600">
            Use your microphone to play the patient, or choose a sample reply in the guided simulation.
            A follow-up request is recorded in this demo workspace for a human coordinator.
          </p>

          <div role="status" className="flex items-center gap-3 px-2.5 py-1.5 rounded bg-slate-50 border border-slate-200">
            <Volume2
              className={`w-4 h-4 shrink-0 ${
                isAiSpeaking ? 'text-sky-700' : waveActive ? 'text-emerald-600' : 'text-slate-400'
              }`}
            />
            <div className="flex items-end gap-0.5 h-4 shrink-0" aria-hidden="true">
              {[0.4, 0.85, 0.55, 1, 0.65, 0.9, 0.45, 0.75, 0.5, 0.85].map((h, i) => (
                <span
                  key={i}
                  className={`w-1 rounded-xs transition-all duration-200 ${
                    isAiSpeaking
                      ? 'bg-sky-600'
                      : waveActive
                        ? 'bg-emerald-600'
                        : 'bg-slate-300'
                  }`}
                  style={{
                    height: waveActive
                      ? `${Math.round((isAiSpeaking ? h : h * 0.65) * 16)}px`
                      : '3px',
                  }}
                />
              ))}
            </div>
            <p className="text-xs text-slate-700 truncate">
              {isProcessingTurn ? 'Evaluating spoken justification & pathway risk...' : statusNote}
            </p>
          </div>
        </div>

        {/* Human-in-the-Loop Safeguard & Barrier Verification Panel */}
        <div className="mx-4 mt-2.5 px-3 py-2.5 rounded-md border border-slate-200 bg-slate-50/80 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              {patient.callStatus === 'Confirmed Attending' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : patient.callStatus === 'Appointment Cancelled' ? (
                <PhoneOff className="w-4 h-4 text-red-600 shrink-0" />
              ) : patient.callStatus === 'Follow-Up Required (Human Callback Queued)' ? (
                <UserCheck className="w-4 h-4 text-amber-600 shrink-0" />
              ) : (
                <Clock className="w-4 h-4 text-slate-500 shrink-0" />
              )}
              <span className="font-semibold text-slate-900">Status: {patient.callStatus}</span>
              {patient.overriddenByHuman && (
                <span className="text-[11px] font-mono text-sky-700 font-semibold">
                  · Human Verified
                </span>
              )}
            </div>

            {/* Patient / Coordinator Classification Override Dropdown */}
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="barrier-override"
                className="text-[11px] text-slate-600 whitespace-nowrap"
              >
                Classification Override:
              </label>
              <select
                id="barrier-override"
                value={patient.verifiedBarrier ?? ''}
                onChange={(e) => {
                  const val = e.target.value as BarrierCategory;
                  if (val) onOverrideBarrier(patient.id, val);
                }}
                className="bg-white border border-slate-300 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-sky-600"
              >
                <option value="" disabled>
                  Select / Override Barrier...
                </option>
                {BARRIER_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(patient.barrierSummary || patient.recommendedAction || patient.deployedOperationAction) && (
            <div className="text-[11px] space-y-0.5 pt-1.5 border-t border-slate-200">
              {patient.barrierSummary && (
                <p className="text-slate-700">
                  <strong className="text-slate-900">Reason:</strong> {patient.barrierSummary}
                </p>
              )}
              {patient.recommendedAction && (
                <p className="text-sky-800">
                  <strong>{patient.callStatus === 'Appointment Cancelled' ? 'Next step:' : 'Safeguard Action:'}</strong>{' '}
                  {patient.recommendedAction}
                </p>
              )}
              {patient.deployedOperationAction && (
                <p className="text-emerald-800 font-medium">
                  <strong>Deployed Simulator Action:</strong> {patient.deployedOperationAction}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Live Transcript */}
        <div className="flex-1 min-h-32 overflow-y-auto clinical-scroll px-4 py-2.5 space-y-2 bg-white">
          {patient.transcript.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 py-4 border border-dashed border-slate-300 rounded-md bg-slate-50/50">
              <Sparkles className="w-5 h-5 text-sky-700 mb-1.5" />
              <p className="text-xs font-medium text-slate-800">
                Ready for Lung Fast-Track Outreach: {patient.name}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-md">
                Try a microphone conversation or click a "Simulate Patient Voice Reply" scenario below.
                An explicit cancellation request triggers one reason question before the demo appointment is cancelled.
              </p>
            </div>
          ) : (
            patient.transcript.map((line) => (
              <div
                key={line.id}
                className={`rounded-md px-3 py-2 text-xs border ${
                  line.speaker === 'AI Coordinator'
                    ? line.probing
                      ? 'bg-amber-50 border-amber-300 text-amber-950'
                      : 'bg-slate-50 border-slate-200 text-slate-800'
                    : line.speaker === 'Patient'
                      ? 'bg-sky-50 border-sky-200 text-slate-900 ml-4'
                      : 'bg-slate-100 border-slate-200 text-slate-700 italic'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="font-semibold text-[11px] text-slate-700">
                    {line.speaker}
                    {line.probing ? ' · Probing Barrier' : ''}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">{line.timestamp}</span>
                </div>
                <p className="leading-relaxed">{line.text}</p>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>

        {/* Simulated Patient Voice Replies & Manual Input */}
        <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50/80 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {SIMULATED_REPLIES.map((sim) => {
              const btnStyle =
                sim.tone === 'confirm'
                  ? 'border-emerald-300 hover:bg-emerald-50 text-emerald-900'
                  : sim.tone === 'probe'
                    ? 'border-amber-300 hover:bg-amber-50 text-amber-900'
                    : sim.tone === 'urgent'
                      ? 'border-red-300 hover:bg-red-50 text-red-900'
                      : sim.tone === 'no_answer'
                        ? 'border-slate-300 hover:bg-slate-100 text-slate-700'
                        : 'border-sky-200 hover:bg-sky-50 text-sky-900';

              return (
                <button
                  key={sim.id}
                  type="button"
                  disabled={isProcessingTurn}
                  onClick={() => void handleSimulatedReply(sim.utterance)}
                  className={`text-left px-2 py-1.5 rounded border bg-white text-[11px] font-medium transition-colors truncate cursor-pointer disabled:opacity-50 ${btnStyle}`}
                  title={sim.utterance}
                >
                  {sim.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleManualSubmit} className="flex items-center gap-1.5">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Or type patient's spoken response..."
              className="flex-1 bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-600"
            />
            <button
              type="submit"
              disabled={isProcessingTurn || !manualInput.trim()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-800 text-white text-xs font-medium cursor-pointer disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </form>
        </div>
      </section>
    </div>
  );
};
