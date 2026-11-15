import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accessibility,
  ArrowRight,
  BadgeCheck,
  Bot,
  Briefcase,
  Bus,
  CalendarClock,
  CalendarX,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock,
  Gauge,
  HeartPulse,
  Info,
  Languages,
  MapPin,
  MessageCircle,
  Mic,
  MicOff,
  Microscope,
  Phone,
  PhoneCall,
  PhoneMissed,
  PhoneOff,
  Route,
  Search,
  Send,
  ShieldAlert,
  Snowflake,
  Sparkles,
  Stethoscope,
  Tag,
  ThumbsUp,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UserRound,
  Users,
  Voicemail,
  Volume2,
  type LucideIcon,
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
import { BARRIER_CATEGORIES, RISK_TIERS } from '../utils/riskEngine.ts';
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
    label: 'Confirm',
    tone: 'confirm',
    utterance: 'Yes, thank you. I will attend my scheduled lung pathway appointment.',
  },
  {
    id: 'vague',
    label: 'Vague cancel',
    tone: 'probe',
    utterance: "I can't make it to the CT biopsy tomorrow, I need to cancel.",
  },
  {
    id: 'transport',
    label: 'Transport',
    tone: 'barrier',
    utterance:
      'There is no bus or rural transport available from Inari to Oulu in time for the morning CT biopsy.',
  },
  {
    id: 'weather',
    label: 'Weather',
    tone: 'barrier',
    utterance:
      'A heavy winter snowstorm closed our side road and driving is unsafe right now.',
  },
  {
    id: 'scheduling',
    label: 'Work shift',
    tone: 'barrier',
    utterance:
      'My morning work shift supervisor will not release me unless we move it to afternoon.',
  },
  {
    id: 'accessibility',
    label: 'Breathless',
    tone: 'urgent',
    utterance:
      'I am short of breath, dizzy, and need a wheelchair escort—I cannot walk to the transit stop.',
  },
  {
    id: 'language',
    label: 'Language',
    tone: 'barrier',
    utterance:
      'I did not understand the Finnish preparation instructions and need an interpreter.',
  },
  {
    id: 'no_answer',
    label: 'No answer',
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

type Tone = 'red' | 'blue' | 'green' | 'yellow' | 'neutral';

const TONE_TEXT: Record<Tone, string> = {
  red: 'text-cc-red',
  blue: 'text-cc-blue',
  green: 'text-cc-green',
  yellow: 'text-black',
  neutral: 'text-cc-muted',
};

const TONE_STROKE: Record<Tone, string> = {
  red: 'var(--color-cc-red)',
  blue: 'var(--color-cc-blue)',
  green: 'var(--color-cc-green)',
  yellow: 'var(--color-cc-yellow)',
  neutral: 'var(--color-cc-muted)',
};

function tierTone(tier: RiskTier): Tone {
  if (tier === 'Low') return 'green';
  if (tier === 'Medium') return 'yellow';
  return 'red';
}

const STATUS_META: Record<CallStatus, { label: string; icon: LucideIcon; chip: string }> = {
  'Pending Call': { label: 'Pending', icon: Clock, chip: 'bg-cc-yellow-soft text-black' },
  'Calling Live': { label: 'Calling', icon: PhoneCall, chip: 'bg-cc-blue text-white' },
  'Confirmed Attending': { label: 'Confirmed', icon: CheckCircle2, chip: 'bg-cc-green-soft text-cc-green' },
  'Appointment Cancelled': { label: 'Cancelled', icon: CalendarX, chip: 'bg-cc-red-soft text-cc-red' },
  'Follow-Up Required (Human Callback Queued)': { label: 'Follow-up', icon: UserCheck, chip: 'bg-cc-yellow text-black' },
  'No Pick-Up': { label: 'No answer', icon: PhoneMissed, chip: 'bg-cc-red-soft text-cc-red' },
};

const PATHWAY_STEPS: Array<{ stage: PathwayStage; label: string; icon: LucideIcon }> = [
  { stage: 'Referral', label: 'Referral', icon: Send },
  { stage: 'Diagnostic Workup', label: 'Diagnostics', icon: Microscope },
  { stage: 'Treatment Initiation', label: 'Treatment', icon: Stethoscope },
];

const REPLY_TONE: Record<(typeof SIMULATED_REPLIES)[number]['tone'], string> = {
  confirm: 'border-cc-green text-cc-green hover:bg-cc-green-soft',
  probe: 'border-cc-yellow text-black hover:bg-cc-yellow-soft',
  barrier: 'border-cc-blue text-cc-blue hover:bg-cc-blue-soft',
  urgent: 'border-cc-red text-cc-red hover:bg-cc-red-soft',
  no_answer: 'border-cc-line text-black hover:bg-cc-surface',
};

const REPLY_ICON: Record<string, LucideIcon> = {
  confirm: ThumbsUp,
  vague: CircleHelp,
  transport: Bus,
  weather: Snowflake,
  scheduling: Briefcase,
  accessibility: Accessibility,
  language: Languages,
  no_answer: Voicemail,
};

function RiskRing({ score, tier, size }: { score: number; tier: RiskTier; size: number }) {
  const stroke = size >= 80 ? 8 : 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Risk ${score} of 100, ${tier}`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-cc-line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={TONE_STROKE[tierTone(tier)]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
        />
      </svg>
      <span
        className={`absolute font-bold tabular-nums ${size >= 80 ? 'text-3xl' : 'text-lg'}`}
      >
        {score}
      </span>
    </span>
  );
}

function ScoreDelta({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const up = delta > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold tabular-nums ${
        up ? 'text-cc-red' : 'text-cc-green'
      }`}
      aria-label={`Score change ${up ? '+' : ''}${delta}`}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
      {up ? `+${delta}` : delta}
    </span>
  );
}

function StatusChip({ status, large = false }: { status: CallStatus; large?: boolean }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${meta.chip} ${
        large ? 'px-4 py-2 text-base' : 'px-3 py-1 text-sm'
      }`}
      title={status}
    >
      <Icon aria-hidden="true" className={large ? 'h-5 w-5' : 'h-4 w-4'} />
      {meta.label}
    </span>
  );
}

function InfoChip({ icon: Icon, label, title }: { icon: LucideIcon; label: string; title: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-cc-surface px-3 py-1.5 text-base"
      title={title}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-cc-muted" />
      <span className="tabular-nums">{label}</span>
    </span>
  );
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
    'Ready'
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

  const regionMeta = FOCUS_REGIONS[patient.regionId];
  const waveActive = isLiveCalling || isAiSpeaking || micActive;
  const { riskBreakdown } = patient;
  const riskFactors = [
    ['Stage', riskBreakdown.pathwayUrgencyPoints, 28, Microscope],
    ['Age + G8', riskBreakdown.ageFrailtyPoints, 20, HeartPulse],
    ['Distance', riskBreakdown.distanceWeatherPoints, 24, Route],
    ['Access', riskBreakdown.equityLanguagePoints, 16, Languages],
    ['Missed + time', riskBreakdown.historyMissedPoints, 12, PhoneMissed],
  ] as const;
  const stageIndex = PATHWAY_STEPS.findIndex((s) => s.stage === patient.pathwayStage);
  const voiceLabel =
    voiceMode === 'gemini-live'
      ? 'Live'
      : voiceMode === 'web-speech'
        ? 'Speech'
        : voiceMode === 'guided'
          ? 'Guided'
          : 'Standby';

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

  const selectClass =
    'min-h-11 w-full min-w-0 rounded-full border border-cc-line bg-white px-4 text-base text-black focus:border-cc-blue focus:outline-none';

  return (
    <div
      className={`grid grid-cols-1 items-start gap-6 lg:gap-8 ${
        detailsOpen ? 'lg:grid-cols-[minmax(0,44fr)_minmax(0,56fr)]' : ''
      }`}
    >
      {/* Left: patient queue */}
      <section
        className={`flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-cc-line bg-white ${
          detailsOpen ? 'max-h-[560px] lg:h-[880px] lg:max-h-none' : ''
        }`}
      >
        <div className="space-y-4 border-b border-cc-line p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Patients</h2>
            <span
              className="inline-flex items-center gap-2 rounded-full bg-cc-surface px-3 py-1.5 text-base font-semibold tabular-nums"
              aria-label={`Showing ${filteredQueue.length} of ${patients.length} patients`}
            >
              <Users aria-hidden="true" className="h-4 w-4" />
              {filteredQueue.length}/{patients.length}
            </span>
          </div>

          <div className={`grid grid-cols-2 gap-2 ${detailsOpen ? '' : 'md:grid-cols-6'}`}>
            <div className="relative col-span-2">
              <Search
                aria-hidden="true"
                className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-cc-muted"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search patient, municipality, or ID"
                className="min-h-11 w-full rounded-full border border-cc-line bg-white pl-12 pr-4 text-base text-black placeholder:text-cc-muted focus:border-cc-blue focus:outline-none"
              />
            </div>

            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value as FocusRegionId | 'ALL')}
              aria-label="Filter queue by region"
              className={selectClass}
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
              onChange={(e) => setStageFilter(e.target.value as PathwayStage | 'ALL')}
              aria-label="Filter queue by pathway stage"
              className={selectClass}
            >
              <option value="ALL">All stages</option>
              <option value="Referral">Referral</option>
              <option value="Diagnostic Workup">Diagnostics</option>
              <option value="Treatment Initiation">Treatment</option>
            </select>

            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as RiskTier | 'ALL')}
              aria-label="Filter queue by risk tier"
              className={selectClass}
            >
              <option value="ALL">All risk</option>
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
              className={selectClass}
            >
              <option value="ALL">All status</option>
              <option value="Pending Call">Pending</option>
              <option value="Follow-Up Required (Human Callback Queued)">Follow-up</option>
              <option value="Confirmed Attending">Confirmed</option>
              <option value="Appointment Cancelled">Cancelled</option>
              <option value="No Pick-Up">No answer</option>
            </select>
          </div>
        </div>

        <div
          className={`min-h-0 flex-1 divide-y divide-cc-line ${
            detailsOpen ? 'clinical-scroll overflow-y-auto' : ''
          }`}
        >
          {filteredQueue.map((p) => {
            const isExpanded = detailsOpen && p.id === patient.id;
            const isRecent = p.id === recentlyUpdatedId;

            return (
              <button
                key={p.id}
                type="button"
                aria-expanded={isExpanded}
                aria-controls="selected-patient-panel"
                onClick={() => togglePatientDetails(p.id)}
                className={`flex w-full cursor-pointer items-center gap-4 px-5 py-4 text-left transition-colors sm:px-6 ${
                  isExpanded
                    ? 'bg-cc-blue-soft shadow-[inset_4px_0_0_var(--color-cc-blue)]'
                    : isRecent
                      ? 'bg-cc-blue-soft'
                      : 'hover:bg-cc-surface'
                }`}
              >
                <RiskRing score={p.riskScore} tier={p.riskTier} size={56} />

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-lg font-semibold">{p.name}</span>
                    <span className="shrink-0 text-base text-cc-muted tabular-nums">{p.age}</span>
                    {p.clinicalNurseAlert && (
                      <ShieldAlert
                        aria-label="Nurse alert"
                        className="h-5 w-5 shrink-0 text-cc-red"
                      />
                    )}
                    <ScoreDelta delta={p.scoreDelta} />
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-base text-cc-muted">
                    <MapPin aria-hidden="true" className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {p.municipality} · <span className="tabular-nums">{p.distanceKm} km</span>
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusChip status={p.callStatus} />
                    {p.verifiedBarrier && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-cc-surface px-3 py-1 text-sm font-medium">
                        <Tag aria-hidden="true" className="h-3.5 w-3.5" />
                        {p.verifiedBarrier}
                      </span>
                    )}
                    {!detailsOpen && (
                      <span className="hidden items-center gap-1.5 rounded-full bg-cc-surface px-3 py-1 text-sm font-medium sm:inline-flex">
                        {(() => {
                          const step = PATHWAY_STEPS.find((s) => s.stage === p.pathwayStage);
                          const StepIcon = step?.icon ?? Microscope;
                          return <StepIcon aria-hidden="true" className="h-3.5 w-3.5" />;
                        })()}
                        {p.appointmentType}
                      </span>
                    )}
                  </div>
                </div>

                <ChevronDown
                  aria-hidden="true"
                  className={`h-5 w-5 shrink-0 text-cc-muted transition-transform ${
                    isExpanded ? 'rotate-180' : ''
                  }`}
                />
              </button>
            );
          })}
        </div>
      </section>

      {/* Right: selected patient + call console */}
      <section
        ref={detailsPanelRef}
        id="selected-patient-panel"
        aria-label="Selected patient details"
        hidden={!detailsOpen}
        className={`clinical-scroll min-w-0 scroll-mt-4 flex-col overflow-hidden rounded-[20px] border border-cc-line bg-white lg:h-[880px] lg:overflow-y-auto ${
          detailsOpen ? 'flex' : 'hidden'
        }`}
      >
        {/* Patient header */}
        <div className="space-y-6 p-5 sm:p-6 lg:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h2 className="text-2xl font-bold leading-tight tracking-tight sm:text-4xl">
                  {patient.name}
                </h2>
                <span className="text-xl text-cc-muted tabular-nums">{patient.age}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {patient.clinicalNurseAlert && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-cc-red px-3 py-1.5 text-base font-semibold text-white">
                    <ShieldAlert aria-hidden="true" className="h-4 w-4" />
                    Nurse alert
                  </span>
                )}
                <InfoChip icon={MapPin} label={patient.municipality} title={`${patient.municipality} · ${regionMeta.name}`} />
                <InfoChip icon={Route} label={`${patient.distanceKm} km`} title="Distance to care hub" />
                <InfoChip icon={HeartPulse} label={`G8 ${patient.g8FrailtyScore}/17`} title="G8 frailty score" />
                <InfoChip icon={Languages} label={patient.primaryLanguage} title="Language" />
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-center gap-1.5">
              <RiskRing score={patient.riskScore} tier={patient.riskTier} size={96} />
              <div className="flex items-center gap-1.5">
                <span className={`text-sm font-semibold ${TONE_TEXT[tierTone(patient.riskTier)]}`}>
                  {patient.riskTier}
                </span>
                <ScoreDelta delta={patient.scoreDelta} />
              </div>
            </div>
          </div>

          {/* Pathway stepper */}
          <ol className="grid grid-cols-3" aria-label="Care pathway">
            {PATHWAY_STEPS.map((step, i) => {
              const done = i < stageIndex;
              const current = i === stageIndex;
              const StepIcon = done ? Check : step.icon;
              return (
                <li
                  key={step.stage}
                  className="relative flex flex-col items-center gap-1.5"
                  aria-current={current ? 'step' : undefined}
                >
                  {i < PATHWAY_STEPS.length - 1 && (
                    <span
                      aria-hidden="true"
                      className={`absolute left-[calc(50%+30px)] right-[calc(-50%+30px)] top-[20px] h-1 rounded-full ${
                        done ? 'bg-cc-green' : 'bg-cc-line'
                      }`}
                    />
                  )}
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-full ${
                      done
                        ? 'bg-cc-green text-white'
                        : current
                          ? 'bg-cc-blue text-white'
                          : 'bg-cc-surface text-cc-muted'
                    }`}
                  >
                    <StepIcon aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <span className={`text-sm ${current ? 'font-semibold text-black' : 'text-cc-muted'}`}>
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>

          {/* Timing tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Appointment timing">
            {patient.callStatus === 'Appointment Cancelled' ? (
              <div className="col-span-2 flex items-center gap-3 rounded-2xl bg-cc-red-soft p-4 text-lg font-semibold text-cc-red">
                <CalendarX aria-hidden="true" className="h-6 w-6" /> Cancelled
              </div>
            ) : (
              <>
                <div className="rounded-2xl bg-cc-surface p-4">
                  <div className="text-3xl font-bold tabular-nums">{patient.daysElapsed}</div>
                  <div className="text-sm text-cc-muted">days elapsed</div>
                </div>
                <div
                  className={`rounded-2xl p-4 ${
                    patient.daysUntilAppointment < 0 ? 'bg-cc-red-soft' : 'bg-cc-blue-soft'
                  }`}
                >
                  <div className="flex items-center gap-2 text-3xl font-bold tabular-nums">
                    <Clock aria-hidden="true" className="h-6 w-6" />
                    {patient.daysUntilAppointment === 0
                      ? 'Today'
                      : Math.abs(patient.daysUntilAppointment)}
                  </div>
                  <div className="text-sm text-cc-muted">
                    {patient.daysUntilAppointment === 0
                      ? 'appointment'
                      : patient.daysUntilAppointment > 0
                        ? 'days to appt.'
                        : 'days overdue'}
                  </div>
                </div>
              </>
            )}
            <div className="col-span-2 flex items-center gap-3 rounded-2xl border border-cc-line p-4 sm:col-span-1">
              <CalendarClock aria-hidden="true" className="h-6 w-6 shrink-0 text-cc-blue" />
              <span className="min-w-0 text-base font-medium">{patient.appointmentType}</span>
            </div>
          </div>

          {/* Score breakdown */}
          <details className="group rounded-2xl border border-cc-line">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-base font-semibold">
              <Gauge aria-hidden="true" className="h-5 w-5 text-cc-blue" />
              Score
              <ChevronDown
                aria-hidden="true"
                className="ml-auto h-5 w-5 text-cc-muted transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="space-y-3 border-t border-cc-line p-4">
              <p className="text-base tabular-nums text-cc-muted">
                {patient.baselineScore}
                {patient.scoreDelta !== 0 &&
                  ` ${patient.scoreDelta > 0 ? '+' : '−'} ${Math.abs(patient.scoreDelta)}`}{' '}
                = <strong className="text-black">{patient.riskScore}</strong>/100
              </p>
              {riskFactors.map(([label, points, max, Icon]) => (
                <div key={label} className="flex items-center gap-3">
                  <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-cc-muted" />
                  <span className="w-28 shrink-0 text-sm font-medium sm:w-32">{label}</span>
                  <div
                    className="relative h-7 flex-1 overflow-hidden rounded-full bg-cc-surface"
                    role="img"
                    aria-label={`${label}: ${points} of ${max} points`}
                  >
                    <div
                      className="flex h-full items-center justify-end rounded-full bg-cc-red pr-2.5 text-sm font-semibold text-white tabular-nums"
                      style={{ width: `${Math.max(14, Math.round((points / max) * 100))}%` }}
                    >
                      {points}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* Call controls */}
        <div className="space-y-4 border-t border-cc-line p-5 sm:p-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-2">
            {!isLiveCalling ? (
              <>
                <button
                  type="button"
                  onClick={handleStartLiveMicCall}
                  aria-label="Start a microphone conversation"
                  className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full bg-cc-blue px-5 text-base font-semibold text-white transition-opacity hover:opacity-90"
                >
                  <Mic aria-hidden="true" className="h-5 w-5" />
                  Live call
                </button>
                <button
                  type="button"
                  onClick={handleStartGuidedCall}
                  aria-label="Start a guided simulation"
                  className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border border-black bg-white px-5 text-base font-semibold transition-colors hover:bg-cc-surface"
                >
                  <Phone aria-hidden="true" className="h-5 w-5" />
                  Simulate
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleHangUpAndClassify}
                aria-label="End session and review outcome"
                className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full bg-cc-red px-5 text-base font-semibold text-white transition-opacity hover:opacity-90"
              >
                <PhoneOff aria-hidden="true" className="h-5 w-5" />
                End call
              </button>
            )}

            <button
              type="button"
              onClick={() => onRequestHumanCoordinator(patient.id)}
              disabled={patient.humanCoordinatorRequested}
              aria-label={
                patient.humanCoordinatorRequested
                  ? 'Coordinator follow-up requested'
                  : 'Request coordinator follow-up'
              }
              title={
                patient.humanCoordinatorRequested
                  ? 'Coordinator follow-up requested'
                  : 'Request coordinator follow-up'
              }
              className={`inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full px-5 text-base font-semibold transition-colors ${
                patient.humanCoordinatorRequested
                  ? 'bg-cc-yellow-soft text-black'
                  : 'border border-cc-line bg-white hover:bg-cc-surface'
              }`}
            >
              {patient.humanCoordinatorRequested ? (
                <Check aria-hidden="true" className="h-5 w-5" />
              ) : (
                <UserCheck aria-hidden="true" className="h-5 w-5" />
              )}
              Coordinator
            </button>

            <span
              className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-cc-surface px-3 py-1.5 text-sm font-medium"
              title="Voice mode"
            >
              {micActive ? (
                <Mic aria-hidden="true" className="h-4 w-4 text-cc-green" />
              ) : (
                <MicOff aria-hidden="true" className="h-4 w-4 text-cc-muted" />
              )}
              {voiceLabel}
            </span>
          </div>

          <div
            role="status"
            className="flex items-center gap-3 rounded-2xl bg-cc-surface px-4 py-3"
          >
            <Volume2
              aria-hidden="true"
              className={`h-5 w-5 shrink-0 ${
                isAiSpeaking ? 'text-cc-blue' : waveActive ? 'text-cc-green' : 'text-cc-muted'
              }`}
            />
            <div className="flex h-6 shrink-0 items-end gap-0.5" aria-hidden="true">
              {[0.4, 0.85, 0.55, 1, 0.65, 0.9, 0.45, 0.75, 0.5, 0.85].map((h, i) => (
                <span
                  key={i}
                  className={`w-1 rounded-full transition-all duration-200 ${
                    isAiSpeaking ? 'bg-cc-blue' : waveActive ? 'bg-cc-green' : 'bg-cc-line'
                  }`}
                  style={{
                    height: waveActive
                      ? `${Math.round((isAiSpeaking ? h : h * 0.65) * 24)}px`
                      : '4px',
                  }}
                />
              ))}
            </div>
            <p className="min-w-0 text-base">
              {isProcessingTurn ? 'Evaluating…' : statusNote}
            </p>
          </div>
        </div>

        {/* Outcome + human override */}
        <div className="mx-5 space-y-4 rounded-2xl border border-cc-line p-4 sm:mx-6 sm:p-5 lg:mx-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={patient.callStatus} large />
              {patient.overriddenByHuman && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-cc-blue-soft px-3 py-1.5 text-sm font-semibold text-cc-blue">
                  <BadgeCheck aria-hidden="true" className="h-4 w-4" />
                  Verified
                </span>
              )}
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <label htmlFor="barrier-override" className="inline-flex items-center gap-1.5 text-sm font-medium text-cc-muted">
                <Tag aria-hidden="true" className="h-4 w-4" />
                Barrier
              </label>
              <select
                id="barrier-override"
                value={patient.verifiedBarrier ?? ''}
                onChange={(e) => {
                  const val = e.target.value as BarrierCategory;
                  if (val) onOverrideBarrier(patient.id, val);
                }}
                className="min-h-11 rounded-full border border-cc-line bg-white px-4 text-base focus:border-cc-blue focus:outline-none"
              >
                <option value="" disabled>
                  Set
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
            <ul className="space-y-3 border-t border-cc-line pt-4 text-base">
              {patient.barrierSummary && (
                <li className="flex gap-3">
                  <MessageCircle aria-label="Reason" className="mt-0.5 h-5 w-5 shrink-0 text-cc-muted" />
                  <span>{patient.barrierSummary}</span>
                </li>
              )}
              {patient.recommendedAction && (
                <li className="flex gap-3">
                  <ArrowRight aria-label="Next step" className="mt-0.5 h-5 w-5 shrink-0 text-cc-blue" />
                  <span>{patient.recommendedAction}</span>
                </li>
              )}
              {patient.deployedOperationAction && (
                <li className="flex gap-3">
                  <CheckCircle2 aria-label="Deployed action" className="mt-0.5 h-5 w-5 shrink-0 text-cc-green" />
                  <span>{patient.deployedOperationAction}</span>
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Transcript */}
        <div className="clinical-scroll max-h-[480px] min-h-40 flex-1 space-y-3 overflow-y-auto px-5 py-5 sm:px-6 lg:max-h-none lg:px-8">
          {patient.transcript.length === 0 ? (
            <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-cc-line p-6 text-center">
              <Sparkles aria-hidden="true" className="h-7 w-7 text-cc-blue" />
              <p className="text-lg font-semibold">Ready to call</p>
            </div>
          ) : (
            patient.transcript.map((line) => {
              if (line.speaker === 'System') {
                return (
                  <div
                    key={line.id}
                    className="flex items-start gap-2 rounded-2xl border border-dashed border-cc-line px-4 py-3 text-sm text-cc-muted"
                  >
                    <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                    <p className="min-w-0 flex-1 leading-relaxed">{line.text}</p>
                    <span className="shrink-0 tabular-nums">{line.timestamp}</span>
                  </div>
                );
              }
              const isAi = line.speaker === 'AI Coordinator';
              return (
                <div key={line.id} className={`flex ${isAi ? 'justify-start pr-6 sm:pr-12' : 'justify-end pl-6 sm:pl-12'}`}>
                  <div
                    className={`max-w-full rounded-2xl px-4 py-3 ${
                      isAi
                        ? line.probing
                          ? 'bg-cc-yellow-soft'
                          : 'bg-cc-surface'
                        : 'bg-cc-blue-soft'
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2 text-sm text-cc-muted">
                      {isAi ? (
                        <Bot aria-label="AI coordinator" className="h-4 w-4 text-cc-blue" />
                      ) : (
                        <UserRound aria-label="Patient" className="h-4 w-4" />
                      )}
                      {line.probing && (
                        <span className="inline-flex items-center gap-1 font-semibold text-black">
                          <CircleHelp aria-hidden="true" className="h-4 w-4" />
                          Probing
                        </span>
                      )}
                      <span className="ml-auto tabular-nums">{line.timestamp}</span>
                    </div>
                    <p className="text-base leading-relaxed">{line.text}</p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={transcriptEndRef} />
        </div>

        {/* Simulated replies + manual input */}
        <div className="space-y-3 border-t border-cc-line p-5 sm:p-6 lg:px-8">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
            {SIMULATED_REPLIES.map((sim) => {
              const tone = REPLY_TONE[sim.tone];
              const Icon = REPLY_ICON[sim.id] ?? MessageCircle;
              return (
                <button
                  key={sim.id}
                  type="button"
                  disabled={isProcessingTurn}
                  onClick={() => void handleSimulatedReply(sim.utterance)}
                  className={`inline-flex min-h-12 min-w-0 cursor-pointer items-center gap-2 rounded-2xl border px-3 py-1.5 text-left text-base font-medium leading-tight transition-colors disabled:opacity-50 sm:px-4 ${tone}`}
                  title={sim.utterance}
                  aria-label={`Simulate reply: ${sim.label}`}
                >
                  <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                  <span className="min-w-0">{sim.label}</span>
                </button>
              );
            })}
          </div>

          <form onSubmit={handleManualSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Type reply"
              aria-label="Type the patient's spoken response"
              className="min-h-12 min-w-0 flex-1 rounded-full border border-cc-line bg-white px-5 text-base placeholder:text-cc-muted focus:border-cc-blue focus:outline-none"
            />
            <button
              type="submit"
              disabled={isProcessingTurn || !manualInput.trim()}
              aria-label="Send"
              title="Send"
              className="inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-cc-blue text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Send aria-hidden="true" className="h-5 w-5" />
            </button>
          </form>
        </div>
      </section>
    </div>
  );
};
