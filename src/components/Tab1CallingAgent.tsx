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
import { paginatePatients } from '../utils/pagination.ts';

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
}) => {
  const [regionFilter, setRegionFilter] = useState<FocusRegionId | 'ALL'>('ALL');
  const [stageFilter, setStageFilter] = useState<PathwayStage | 'ALL'>('ALL');
  const [tierFilter, setTierFilter] = useState<RiskTier | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<CallStatus | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [queuePage, setQueuePage] = useState(1);
  const queueListRef = useRef<HTMLDivElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const detailsPanelRef = useRef<HTMLElement | null>(null);

  const [voiceMode, setVoiceMode] = useState<'idle' | 'gemini-live' | 'web-speech' | 'guided'>(
    'idle'
  );
  const [statusNote, setStatusNote] = useState('');
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
  activePatientRef.current = patients.find((p) => p.id === activeCallPatientId) ?? patient;
  const liveTranscriptRef = useRef<TranscriptLine[]>([]);
  const endingCallRef = useRef(false);
  const classificationVersionRef = useRef(0);
  const [isConnecting, setIsConnecting] = useState(false);
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
  const page = paginatePatients(filteredQueue, queuePage);
  useEffect(() => { if (queueListRef.current) queueListRef.current.scrollTop = 0; },
    [page.page, regionFilter, stageFilter, tierFilter, statusFilter, searchQuery]);

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
    if (!activeCallPatientId && voiceMode !== 'idle') {
      cleanupMediaAndSockets();
      setVoiceMode('idle');
    }
  }, [activeCallPatientId, voiceMode]);

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
    if (endingCallRef.current) return;
    const version = ++classificationVersionRef.current;
    setIsProcessingTurn(true);
    try {
      const region = FOCUS_REGIONS[target.regionId];
      const response = await fetch('/api/classify-call', {
        method: 'POST',
        signal: AbortSignal.timeout(20000),
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
      if (endingCallRef.current || version !== classificationVersionRef.current) return;
      if (['call_ended', 'no_answer', 'cancelled', 'confirmed', 'declined_classified'].includes(data.outcome)) {
        await voiceAudio.waitForLivePlayback();
        if (endingCallRef.current || version !== classificationVersionRef.current) return;
      }
      if (data.outcome === 'call_ended' || data.outcome === 'no_answer') {
        endingCallRef.current = true;
        cleanupMediaAndSockets();
        setVoiceMode('idle');
        onEndCall();
        setStatusNote('Call ended · appointment unchanged.');
      } else if (data.outcome === 'cancellation_reason_requested') {
        setStatusNote('Cancellation requested — waiting for the patient’s reason.');
      } else if (data.outcome === 'cancelled') {
        endingCallRef.current = true;
        onApplyOutcome(target.id, {
          callStatus: 'Appointment Cancelled',
          barrierCategory: data.barrierCategory ?? 'Other',
          barrierSummary: data.barrierSummary ?? latestPatientText,
          recommendedAction: data.recommendedAction,
          clinicalNurseAlert: data.clinicalNurseAlert,
          humanCoordinatorRequested: false,
        });
        setStatusNote('Appointment cancelled after the reason was requested.');
        cleanupMediaAndSockets();
        setVoiceMode('idle');
        onEndCall();
      } else if (data.outcome === 'confirmed' || data.outcome === 'declined_classified') {
        onApplyOutcome(target.id, {
          callStatus: data.outcome === 'confirmed' ? 'Confirmed Attending' : 'Follow-Up Required (Human Callback Queued)',
          barrierCategory: data.barrierCategory,
          barrierSummary: data.barrierSummary,
          recommendedAction: data.recommendedAction,
          clinicalNurseAlert: data.clinicalNurseAlert,
          humanCoordinatorRequested: data.outcome === 'declined_classified',
        });
        endingCallRef.current = true;
        cleanupMediaAndSockets();
        setVoiceMode('idle');
        onEndCall();
        setStatusNote(data.outcome === 'confirmed' ? 'Call ended · attendance confirmed.' : 'Call ended · coordinator follow-up recorded.');
      }
    } catch (error) {
      if (version !== classificationVersionRef.current) return;
      setStatusNote(
        error instanceof Error ? error.message : 'Gemini could not classify the completed turn.'
      );
    } finally {
      if (version === classificationVersionRef.current) setIsProcessingTurn(false);
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
      setStatusNote('Microphone unavailable. Check browser microphone permissions and try again.');
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
      setStatusNote('Listening — speak naturally.');
    } catch {
      setVoiceMode('guided');
      setStatusNote('Microphone unavailable. Check browser microphone permissions and try again.');
    }
  };

  const handleStartLiveMicCall = async () => {
    if (activeCallPatientId || isConnecting || isProcessingTurn) return;
    setIsConnecting(true);
    try {
    cleanupMediaAndSockets();
    const target = activePatientRef.current;
    endingCallRef.current = false;
    classificationVersionRef.current += 1;
    liveTranscriptRef.current = [];
    liveAiBufferRef.current = '';
    liveUserBufferRef.current = '';
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
      if (wsRef.current !== ws) return;
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
            setVoiceMode('idle');
            onEndCall();
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
          const completedTranscript = [...liveTranscriptRef.current];
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
          liveTranscriptRef.current = completedTranscript;
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
          void handleHangUpAndClassify();
          return;
        }
        if (msg.type === 'live_closed') {
          void handleHangUpAndClassify();
        }
      } catch {
        // noop
      }
    };

    ws.onerror = () => {
      if (!switchedToFallback) {
        switchedToFallback = true;
        void handleHangUpAndClassify();
      }
    };

    ws.onclose = () => {
      if (!switchedToFallback && wsRef.current === ws) {
        void handleHangUpAndClassify();
      }
    };
    } finally {
      setIsConnecting(false);
    }
  };

  const handleStartGuidedCall = () => {
    cleanupMediaAndSockets();
    const target = activePatientRef.current;
    onStartCall(target.id);
    setVoiceMode('guided');
    voiceAudio.playDialTone();
    setStatusNote('Call connected.');
    speakGreeting(target);
  };

  const handleHangUpAndClassify = async () => {
    if (endingCallRef.current) return;
    endingCallRef.current = true;
    classificationVersionRef.current += 1;
    const transcript = [...liveTranscriptRef.current];
    for (const [speaker, text] of [
      ['Patient', liveUserBufferRef.current.trim()],
      ['AI Coordinator', liveAiBufferRef.current.trim()],
    ] as const) {
      if (!text) continue;
      const line: TranscriptLine = { id: `end-${speaker}-${Date.now()}`, speaker, text, timestamp: nowTime() };
      transcript.push(line);
      onAppendTranscript(activePatientRef.current.id, line);
    }
    liveUserBufferRef.current = '';
    liveAiBufferRef.current = '';
    const target = { ...activePatientRef.current, transcript };
    cleanupMediaAndSockets();
    setVoiceMode('idle');
    onEndCall();
    const hadPatientLines = target.transcript.some((t) => t.speaker === 'Patient');
    let completionNote = 'Call finished.';

    if (hadPatientLines) {
      setIsProcessingTurn(true);
      try {
        const region = FOCUS_REGIONS[target.regionId];
        const resp = await fetch('/api/classify-call', {
          method: 'POST',
          signal: AbortSignal.timeout(20000),
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
              humanCoordinatorRequested: false,
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
    ['Travel distance', riskBreakdown.distanceWeatherPoints, patient.distanceKm + ' km to the assigned care hub. Points use distance bands.'],
    ['Access support', riskBreakdown.equityLanguagePoints, 'Recorded language barrier, financial vulnerability, or accessibility need.'],
    ['Previous missed contacts', riskBreakdown.historyMissedPoints, patient.priorMissedCalls + ' prior missed calls recorded. This is coordination history, not clinical cancer risk.'],
    ['Appointment coordination urgency', riskBreakdown.appointmentTimingPoints, patient.daysUntilAppointment < 0 ? 'The appointment date has passed.' : patient.daysUntilAppointment === 0 ? 'The appointment is today.' : patient.daysUntilAppointment + ' days remain. Timing adds priority only when an access risk is recorded.'],
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
                Showing {page.from}–{page.to} of {filteredQueue.length} matching patients
              </p>
            </div>
          </div>

          <div className={`grid grid-cols-2 gap-1.5 ${detailsOpen ? '' : 'md:grid-cols-6'}`}>
            <div className="relative col-span-2">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setQueuePage(1); }}
                placeholder="Search patient, municipality, or ID..."
                className="w-full bg-white border border-slate-300 rounded pl-8 pr-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-600"
              />
            </div>

            <select
              value={regionFilter}
              onChange={(e) => { setRegionFilter(e.target.value as FocusRegionId | 'ALL'); setQueuePage(1); }}
              aria-label="Filter queue by region"
              className="bg-white border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-sky-600"
            >
              <option value="ALL">All regions</option>
              {FOCUS_REGION_ORDER.map((id) => (
                <option key={id} value={id}>
                  {FOCUS_REGIONS[id].shortLabel}
                </option>
              ))}
            </select>

            <select
              value={stageFilter}
              onChange={(e) => { setStageFilter(e.target.value as PathwayStage | 'ALL'); setQueuePage(1); }}
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
              onChange={(e) => { setTierFilter(e.target.value as RiskTier | 'ALL'); setQueuePage(1); }}
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
              onChange={(e) => { setStatusFilter(e.target.value as CallStatus | 'ALL'); setQueuePage(1); }}
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

        <div ref={queueListRef} className={`flex-1 min-h-0 divide-y divide-slate-200 ${detailsOpen ? 'overflow-y-auto clinical-scroll' : ''}`}>
          {page.items.length === 0 && <p className="p-4 text-sm">No patients match these filters.</p>}
          {page.items.map((p) => {
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
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-700">
                      <Phone aria-hidden="true" className="h-3.5 w-3.5" />
                      <span aria-label="Phone number">{p.phoneNumber}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 text-right">
                    <div>
                      <div className="flex items-center justify-end gap-1 font-mono tabular-nums">
                        <span className="text-sm font-bold text-slate-900">{p.riskScore}</span>
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
        <nav className="patient-pagination" aria-label="Patient pages">
          <button type="button" disabled={page.page === 1} onClick={() => setQueuePage(page.page - 1)}>Previous</button>
          <span role="status">Page {page.page} of {page.pageCount}</span>
          <button type="button" disabled={page.page === page.pageCount} onClick={() => setQueuePage(page.page + 1)}>Next</button>
        </nav>
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

              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-700">
                <Phone aria-hidden="true" className="h-4 w-4" /> {patient.phoneNumber}
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
                The outreach score ranks patients for coordinator follow-up. Baseline {patient.baselineScore}
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

        {/* Real outbound phone call */}
        <div className="px-4 py-2.5 border-b border-slate-200 bg-white space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-56 flex-1 text-xs font-medium text-slate-800">
              Phone number
              <input
                type="tel"
                value={patient.phoneNumber}
                readOnly
                className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-base text-black"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleStartLiveMicCall()}
              disabled={Boolean(activeCallPatientId) || isConnecting || isProcessingTurn}
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-sky-700 px-4 py-2 text-base font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Phone aria-hidden="true" className="h-5 w-5" />
              {isConnecting ? 'Connecting…' : activeCallPatientId ? 'Call in progress' : 'Call patient'}
            </button>
            {patient.humanCoordinatorRequested && (
              <span className="inline-flex min-h-11 items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
                <PhoneCall aria-hidden="true" className="h-4 w-4" />
                Coordinator follow-up promised
              </span>
            )}
          </div>
          {(isProcessingTurn || statusNote) && (
            <div role="status" className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <PhoneCall aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-700" />
              <p className="text-sm text-slate-800">
                {isProcessingTurn ? 'Updating call outcome…' : statusNote}
              </p>
            </div>
          )}
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
                  <strong>Support plan:</strong> {patient.deployedOperationAction}
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
                Call history
              </p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-md">
                Conversation notes and appointment updates will appear here after a call.
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

      </section>
    </div>
  );
};
