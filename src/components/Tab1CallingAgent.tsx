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
  AudioLines,
  MessagesSquare,
  Pin,
} from 'lucide-react';
import { FEATURED_DEMO_PATIENT_ID, FOCUS_REGIONS, FOCUS_REGION_ORDER } from '../data/patients.ts';
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

type ReplyTone = 'confirm' | 'probe' | 'barrier' | 'urgent' | 'no_answer';
interface QuickReply { id: string; label: string; tone: ReplyTone; utterance: string }

// 2-3 quick replies for the presenter (Plan B), plus "No answer".
function quickReplies(p: { municipality: string }): QuickReply[] {
  return [
    { id: 'transport', label: `No bus from ${p.municipality}`, tone: 'barrier', utterance: `There's no bus from ${p.municipality} that morning, so I can't get there.` },
    { id: 'cancel', label: 'I need to cancel', tone: 'probe', utterance: "I can't make it, I need to cancel the appointment." },
    { id: 'confirm', label: "I'll be there", tone: 'confirm', utterance: "Yes, I'll be there. Thank you." },
    { id: 'no_answer', label: 'No answer', tone: 'no_answer', utterance: '[NO_ANSWER_VOICEMAIL]' },
  ];
}

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

const REPLY_TONE: Record<ReplyTone, string> = {
  confirm: 'border-cc-green text-cc-green hover:bg-cc-green-soft',
  probe: 'border-cc-yellow text-black hover:bg-cc-yellow-soft',
  barrier: 'border-cc-blue text-cc-blue hover:bg-cc-blue-soft',
  urgent: 'border-cc-red text-cc-red hover:bg-cc-red-soft',
  no_answer: 'border-cc-line text-black hover:bg-cc-surface',
};

const REPLY_ICON: Record<string, LucideIcon> = {
  confirm: ThumbsUp,
  cancel: CalendarX,
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
  const [statusNote, setStatusNote] = useState<string>('Ready');
  // 'live' = Gemini Live voice; 'turn' = Plan B turn-based Gemini call (speech/text -> /api/call-turn -> TTS).
  const [callMode, setCallMode] = useState<'live' | 'turn'>('live');
  const liveWatchdogRef = useRef<number | null>(null);
  const liveAudioSeenRef = useRef(false);
  const callActiveRef = useRef(false);
  const speechInputOkRef = useRef(true);
  const turnBusyRef = useRef(false);
  const evaluatingRef = useRef(false);
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
  const transcriptBoxRef = useRef<HTMLDivElement | null>(null);

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
      // Demo patient (Matti) is pinned on top so the preselected card matches the list.
      .sort((a, b) =>
        Number(b.id === FEATURED_DEMO_PATIENT_ID) - Number(a.id === FEATURED_DEMO_PATIENT_ID) ||
        b.riskScore - a.riskScore
      );
  }, [patients, regionFilter, stageFilter, tierFilter, statusFilter, searchQuery]);
  const page = paginatePatients(filteredQueue, queuePage);
  useEffect(() => { if (queueListRef.current) queueListRef.current.scrollTop = 0; },
    [page.page, regionFilter, stageFilter, tierFilter, statusFilter, searchQuery]);

  // Scroll only the transcript box itself; never the window or the details card.
  useEffect(() => {
    const box = transcriptBoxRef.current;
    if (detailsOpen && box && patient.transcript.length > 0) box.scrollTop = box.scrollHeight;
  }, [detailsOpen, patient.transcript.length]);
  // Details card always starts at the top (patient name + score ring visible).
  useEffect(() => {
    if (detailsPanelRef.current) detailsPanelRef.current.scrollTop = 0;
  }, [patient.id, detailsOpen]);

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

  const patientPayload = (target: PatientRecord) => {
    const region = FOCUS_REGIONS[target.regionId];
    return {
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
    };
  };

  const appendLine = (patientId: string, line: TranscriptLine) => {
    liveTranscriptRef.current = [...liveTranscriptRef.current, line];
    onAppendTranscript(patientId, line);
  };

  /** Speaks an agent line (male voice) and resolves when playback ends. */
  const speakAgentLine = async (text: string) => {
    setIsAiSpeaking(true);
    try {
      await voiceAudio.speakAgent(text, 'male');
    } finally {
      setIsAiSpeaking(false);
    }
  };

  const clearLiveWatchdog = () => {
    if (liveWatchdogRef.current !== null) {
      window.clearTimeout(liveWatchdogRef.current);
      liveWatchdogRef.current = null;
    }
  };

  /** Ends the call in the UI without classification (outcome already applied). */
  const finishCall = (note: string) => {
    endingCallRef.current = true;
    callActiveRef.current = false;
    clearLiveWatchdog();
    cleanupMediaAndSockets();
    setVoiceMode('idle');
    onEndCall();
    setStatusNote(note);
  };

  const speakGreeting = async (target: PatientRecord) => {
    const region = FOCUS_REGIONS[target.regionId];
    const greeting =
      `Hello ${target.name.split(' ')[0]}, this is the CareCatalyst care team in ${region.hubCity}. ` +
      `I'm calling about your ${target.appointmentType}, ${target.appointmentTimeLabel.toLowerCase()}. ` +
      `Can you make it, or is something getting in the way?`;
    appendLine(target.id, {
      id: `ai-greet-${Date.now()}`,
      speaker: 'AI Coordinator',
      text: greeting,
      timestamp: nowTime(),
    });
    await speakAgentLine(greeting);
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
      const response = await fetch('/api/classify-call', {
        method: 'POST',
        signal: AbortSignal.timeout(35000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient: patientPayload(target), transcript, summaryText: latestPatientText }),
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
        finishCall('Call ended · appointment unchanged.');
      } else if (data.outcome === 'cancellation_reason_requested') {
        setStatusNote('Cancellation requested · waiting for the reason.');
      } else if (data.outcome === 'cancelled') {
        onApplyOutcome(target.id, {
          callStatus: 'Appointment Cancelled',
          barrierCategory: data.barrierCategory ?? 'Other',
          barrierSummary: data.barrierSummary ?? latestPatientText,
          recommendedAction: data.recommendedAction,
          clinicalNurseAlert: data.clinicalNurseAlert,
          humanCoordinatorRequested: false,
        });
        finishCall(`Cancelled · reason: ${data.barrierCategory ?? 'Other'}.`);
      } else if (data.outcome === 'confirmed' || data.outcome === 'declined_classified') {
        onApplyOutcome(target.id, {
          callStatus: data.outcome === 'confirmed' ? 'Confirmed Attending' : 'Follow-Up Required (Human Callback Queued)',
          barrierCategory: data.barrierCategory,
          barrierSummary: data.barrierSummary,
          recommendedAction: data.recommendedAction,
          clinicalNurseAlert: data.clinicalNurseAlert,
          humanCoordinatorRequested: data.outcome === 'declined_classified',
        });
        finishCall(data.outcome === 'confirmed' ? 'Call ended · attendance confirmed.' : `Barrier: ${data.barrierCategory ?? 'Other'} · appointment held · follow-up queued.`);
      }
    } catch (error) {
      if (version !== classificationVersionRef.current) return;
      setStatusNote(error instanceof Error ? error.message : 'Gemini could not classify the completed turn.');
    } finally {
      if (version === classificationVersionRef.current) setIsProcessingTurn(false);
    }
  };

  const stopListening = () => {
    if (speechRecRef.current) {
      const rec = speechRecRef.current;
      speechRecRef.current = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        // noop
      }
    }
    setMicActive(false);
  };

  /** Plan B listening: one utterance via browser SpeechRecognition, then a Gemini turn. */
  const startListening = () => {
    stopListening();
    if (endingCallRef.current || !callActiveRef.current || !speechInputOkRef.current || evaluatingRef.current) return;
    const SpeechRecCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).webkitSpeechRecognition;
    if (!SpeechRecCtor) {
      speechInputOkRef.current = false;
      setStatusNote('Plan B · type a reply or tap a quick reply.');
      return;
    }
    try {
      const rec = new SpeechRecCtor();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';
      let gotResult = false;
      rec.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const spoken = res.isFinal ? res[0].transcript.trim() : '';
          if (spoken) {
            gotResult = true;
            stopListening();
            void evaluateTurnWithBackend(activePatientRef.current, spoken);
            return;
          }
        }
      };
      rec.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        speechInputOkRef.current = false;
        setMicActive(false);
        setStatusNote(`Plan B · ${speechRecognitionErrorMessage(event.error)}`);
      };
      rec.onend = () => {
        setMicActive(false);
        if (speechRecRef.current === rec) speechRecRef.current = null;
        // Keep listening through silences while the call is still waiting for the patient.
        if (!gotResult && speechInputOkRef.current && callActiveRef.current && !endingCallRef.current && !turnBusyRef.current) {
          window.setTimeout(startListening, 250);
        }
      };
      rec.start();
      speechRecRef.current = rec;
      setMicActive(true);
      setStatusNote('Plan B · listening… or type / tap a reply.');
    } catch {
      speechInputOkRef.current = false;
      setStatusNote('Plan B · type a reply or tap a quick reply.');
    }
  };

  const evaluateTurnWithBackend = async (targetPatient: PatientRecord, patientUtterance: string) => {
    if (endingCallRef.current || evaluatingRef.current) return;
    stopListening();
    evaluatingRef.current = true;
    try {
      await runTurn(targetPatient, patientUtterance);
    } finally {
      evaluatingRef.current = false;
    }
    if (callActiveRef.current && !endingCallRef.current) startListening();
  };

  const runTurn = async (targetPatient: PatientRecord, patientUtterance: string) => {
    if (patientUtterance === '[NO_ANSWER_VOICEMAIL]') {
      appendLine(targetPatient.id, {
        id: `sys-noans-${Date.now()}`,
        speaker: 'System',
        text: 'No answer · appointment held (never auto-cancelled) · coordinator callback queued.',
        timestamp: nowTime(),
      });
      onApplyOutcome(targetPatient.id, {
        callStatus: 'No Pick-Up',
        barrierCategory: null,
        barrierSummary: 'Call unanswered / voicemail reached.',
        recommendedAction: 'Hold the fast-track slot; coordinator callback within 2 h.',
        clinicalNurseAlert: false,
        humanCoordinatorRequested: true,
      });
      voiceAudio.playOutcomeTone('escalated');
      finishCall('No answer · slot held · callback queued.');
      return;
    }

    const patientLine: TranscriptLine = {
      id: `pat-${Date.now()}`,
      speaker: 'Patient',
      text: patientUtterance,
      timestamp: nowTime(),
    };
    appendLine(targetPatient.id, patientLine);
    turnBusyRef.current = true;
    setIsProcessingTurn(true);

    try {
      const resp = await fetch('/api/call-turn', {
        method: 'POST',
        signal: AbortSignal.timeout(35000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient: patientPayload(targetPatient),
          transcript: liveTranscriptRef.current,
          latestText: patientUtterance,
        }),
      });
      if (!resp.ok) {
        const failure = await resp.json().catch(() => ({}));
        throw new Error(failure.error || 'Gemini could not respond. Please try again.');
      }
      const data = (await resp.json()) as CallTurnApiResponse;
      if (endingCallRef.current) return;

      appendLine(targetPatient.id, {
        id: `ai-${Date.now()}`,
        speaker: 'AI Coordinator',
        text: data.aiReply,
        timestamp: nowTime(),
        probing: data.needsProbe,
      });
      setIsProcessingTurn(false);

      const terminal = ['cancelled', 'confirmed', 'declined_classified', 'call_ended', 'no_answer'].includes(data.outcome);
      if (data.outcome === 'cancelled') {
        onApplyOutcome(targetPatient.id, {
          callStatus: 'Appointment Cancelled',
          barrierCategory: data.barrierCategory ?? 'Other',
          barrierSummary: data.barrierSummary ?? patientUtterance,
          recommendedAction: data.recommendedAction,
          clinicalNurseAlert: data.clinicalNurseAlert,
          humanCoordinatorRequested: false,
        });
        voiceAudio.playOutcomeTone('escalated');
      } else if (data.outcome === 'confirmed') {
        onApplyOutcome(targetPatient.id, {
          callStatus: 'Confirmed Attending',
          barrierCategory: null,
          barrierSummary: data.barrierSummary ?? 'Patient confirmed attendance.',
          recommendedAction: data.recommendedAction,
          clinicalNurseAlert: false,
        });
        voiceAudio.playOutcomeTone('confirmed');
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
      }
      if (terminal) endingCallRef.current = true; // outcome recorded; End call must not re-classify
      setStatusNote(
        data.outcome === 'cancellation_reason_requested'
          ? 'Cancellation requested · Gemini asks for the reason.'
          : data.outcome === 'continue_probe'
            ? 'Gemini asks one follow-up question.'
            : data.outcome === 'cancelled'
              ? `Cancelled · reason: ${data.barrierCategory ?? 'Other'}.`
              : data.outcome === 'confirmed'
                ? 'Attendance confirmed.'
                : data.outcome === 'declined_classified'
                  ? `Barrier: ${data.barrierCategory ?? 'Other'} · appointment held · follow-up queued.`
                  : 'Call ended · appointment unchanged.'
      );

      await speakAgentLine(data.aiReply);
      if (terminal) {
        callActiveRef.current = false;
        clearLiveWatchdog();
        cleanupMediaAndSockets();
        setVoiceMode('idle');
        onEndCall();
        return;
      }
      turnBusyRef.current = false;
    } catch (err) {
      setStatusNote(`Gemini turn failed: ${err instanceof Error ? err.message : 'unable to evaluate response.'} Try again.`);
    } finally {
      turnBusyRef.current = false;
      setIsProcessingTurn(false);
    }
  };

  /**
   * Plan B: turn-based call that still uses Gemini (browser speech or typed input ->
   * /api/call-turn -> spoken reply via /api/tts). Also used when Gemini Live fails.
   */
  const startTurnBasedCall = async (target: PatientRecord, reason?: string, options: { listen?: boolean } = {}) => {
    clearLiveWatchdog();
    cleanupMediaAndSockets();
    if (!callActiveRef.current) {
      endingCallRef.current = false;
      classificationVersionRef.current += 1;
      liveTranscriptRef.current = [];
      liveAiBufferRef.current = '';
      liveUserBufferRef.current = '';
      callActiveRef.current = true;
      onStartCall(target.id);
      voiceAudio.playDialTone();
    }
    speechInputOkRef.current = true;
    setCallMode('turn'); // keep the mode toggle in sync after a Live fallback
    setVoiceMode('web-speech');
    setStatusNote(reason ? `Plan B · ${reason}` : 'Turn-based call connected.');
    if (!liveTranscriptRef.current.some((line) => line.speaker === 'AI Coordinator')) {
      turnBusyRef.current = true;
      await speakGreeting(target);
      turnBusyRef.current = false;
    }
    if (endingCallRef.current) return;
    if (options.listen !== false) startListening();
  };

  /** Switch a failing Gemini Live call to Plan B without losing the transcript. */
  const fallbackToTurnBased = (reason: string) => {
    if (endingCallRef.current || !callActiveRef.current) return;
    clearLiveWatchdog();
    for (const [speaker, text] of [
      ['Patient', liveUserBufferRef.current.trim()],
      ['AI Coordinator', liveAiBufferRef.current.trim()],
    ] as const) {
      if (text) appendLine(activePatientRef.current.id, { id: `fb-${speaker}-${Date.now()}`, speaker, text, timestamp: nowTime() });
    }
    liveUserBufferRef.current = '';
    liveAiBufferRef.current = '';
    void startTurnBasedCall(activePatientRef.current, reason);
  };

  const handleStartLiveMicCall = async () => {
    if (activeCallPatientId || isConnecting || isProcessingTurn) return;
    setIsConnecting(true);
    try {
      cleanupMediaAndSockets();
      const target = activePatientRef.current;
      endingCallRef.current = false;
      callActiveRef.current = false;
      classificationVersionRef.current += 1;
      liveTranscriptRef.current = [];
      liveAiBufferRef.current = '';
      liveUserBufferRef.current = '';
      liveAudioSeenRef.current = false;
      setStatusNote('Checking Gemini connection…');
      try {
        const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
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
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new DOMException('getUserMedia is unavailable', 'NotSupportedError');
        }
        // A pending permission prompt can hang forever: give up after 8 s.
        let micTimer: number | undefined;
        let micTimedOut = false;
        const micRequest = navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        try {
          micStream = await Promise.race([
            micRequest,
            new Promise<never>((_, reject) => {
              micTimer = window.setTimeout(() => {
                micTimedOut = true;
                reject(new DOMException('Microphone request timed out', 'TimeoutError'));
              }, 8000);
            }),
          ]);
        } finally {
          window.clearTimeout(micTimer);
        }
        if (micTimedOut) throw new DOMException('Microphone request timed out', 'TimeoutError');
        micStreamRef.current = micStream;
        // A stream granted after the timeout is released right away.
        void micRequest.then((late) => { if (late !== micStreamRef.current) late.getTracks().forEach((t) => t.stop()); }, () => {});
      } catch (error) {
        // Plan B: no microphone for Live -> turn-based call with typed / quick replies.
        console.warn('Microphone unavailable:', microphoneErrorMessage(error));
        void startTurnBasedCall(target, 'Mic unavailable – switched to text.');
        return;
      }

      callActiveRef.current = true;
      onStartCall(target.id);
      voiceAudio.playDialTone();

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/api/live-call`);
      wsRef.current = ws;

      // No agent audio within 8 s -> Plan B (fallbackToTurnBased closes the socket and stops the mic).
      clearLiveWatchdog();
      liveWatchdogRef.current = window.setTimeout(() => {
        liveWatchdogRef.current = null;
        if (!liveAudioSeenRef.current && wsRef.current === ws) fallbackToTurnBased('Live unavailable – switched to text.');
      }, 8000);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'start', patient: patientPayload(target) }));
      };

      ws.onmessage = (evt) => {
        if (wsRef.current !== ws) return;
        try {
          const msg = JSON.parse(String(evt.data)) as { type?: string; data?: string; text?: string; reason?: string };

          if (msg.type === 'error') {
            finishCall(msg.reason || 'Gemini is unavailable. Check the server configuration.');
            return;
          }

          if (msg.type === 'ready') {
            setVoiceMode('gemini-live');
            micSendEnabledRef.current = true;
            setStatusNote('Gemini Live connected · you can interrupt at any time.');
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
                if (!micSendEnabledRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
                const pcmBase64 = float32ToPcm16Base64(e.inputBuffer.getChannelData(0));
                wsRef.current.send(JSON.stringify({ type: 'audio', data: pcmBase64, sampleRate: ctx.sampleRate }));
              };
              src.connect(proc);
              proc.connect(ctx.destination);
              setMicActive(true);
            } else {
              fallbackToTurnBased('this browser cannot stream live audio.');
            }
            return;
          }

          if (msg.type === 'audio' && msg.data) {
            liveAudioSeenRef.current = true;
            clearLiveWatchdog();
            setIsAiSpeaking(true);
            setStatusNote('Gemini is speaking · you can interrupt.');
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
            const liveUserText = liveUserBufferRef.current.trim() || pendingTypedLine?.text.trim() || '';
            const liveAiText = liveAiBufferRef.current.trim();
            if (liveUserBufferRef.current.trim()) {
              const patientLine: TranscriptLine = { id: `pat-live-${Date.now()}`, speaker: 'Patient', text: liveUserText, timestamp: nowTime() };
              completedTranscript.push(patientLine);
              onAppendTranscript(activePatientRef.current.id, patientLine);
              liveUserBufferRef.current = '';
            } else if (pendingTypedLine && !completedTranscript.some((line) => line.id === pendingTypedLine.id)) {
              completedTranscript.push(pendingTypedLine);
            }
            pendingTypedLiveLineRef.current = null;
            if (liveAiText) {
              const aiLine: TranscriptLine = { id: `ai-live-${Date.now()}`, speaker: 'AI Coordinator', text: liveAiText, timestamp: nowTime() };
              completedTranscript.push(aiLine);
              onAppendTranscript(activePatientRef.current.id, aiLine);
              liveAiBufferRef.current = '';
            }
            liveTranscriptRef.current = completedTranscript;
            micSendEnabledRef.current = true;
            setStatusNote('Listening · speak now or interrupt the next response.');
            if (liveUserText) {
              void classifyCompletedLiveTurn(activePatientRef.current, completedTranscript, liveUserText);
            }
            return;
          }

          if (msg.type === 'interrupted') {
            voiceAudio.stopLivePlayback();
            setIsAiSpeaking(false);
            micSendEnabledRef.current = true;
            setStatusNote('Listening · speak now.');
            return;
          }

          if (msg.type === 'fallback' || msg.type === 'live_closed') {
            fallbackToTurnBased('Gemini Live dropped, switched to turn-based.');
          }
        } catch {
          // noop
        }
      };

      ws.onerror = () => {
        if (wsRef.current === ws) fallbackToTurnBased('Gemini Live connection failed, switched to turn-based.');
      };

      ws.onclose = () => {
        if (wsRef.current === ws) fallbackToTurnBased('Gemini Live closed, switched to turn-based.');
      };
    } finally {
      setIsConnecting(false);
    }
  };

  const handleStartCall = () => {
    if (activeCallPatientId || isConnecting || isProcessingTurn) return;
    if (callMode === 'turn') {
      void startTurnBasedCall(activePatientRef.current);
    } else {
      void handleStartLiveMicCall();
    }
  };

  /** End-call button: stop mic/audio/socket, then classify the transcript so far. */
  const handleHangUpAndClassify = async () => {
    const alreadyClassified = endingCallRef.current;
    endingCallRef.current = true;
    callActiveRef.current = false;
    clearLiveWatchdog();
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
    liveTranscriptRef.current = transcript;
    const target = { ...activePatientRef.current, transcript };
    cleanupMediaAndSockets();
    setVoiceMode('idle');
    onEndCall();
    if (alreadyClassified) {
      setStatusNote('Call ended.');
      return;
    }
    const hadPatientLines = transcript.some((t) => t.speaker === 'Patient');
    if (!hadPatientLines) {
      setStatusNote('Call ended · no reply to classify · appointment unchanged.');
      return;
    }
    let completionNote = 'Call ended · appointment unchanged.';
    setIsProcessingTurn(true);
    setStatusNote('Classifying the call…');
    try {
      const resp = await fetch('/api/classify-call', {
        method: 'POST',
        signal: AbortSignal.timeout(35000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient: patientPayload(target), transcript }),
      });
      if (!resp.ok) {
        const failure = await resp.json().catch(() => ({}));
        throw new Error(failure.error || 'Gemini could not summarize the call.');
      }
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
        completionNote = `Call ended · cancelled · reason: ${data.barrierCategory ?? 'Other'}.`;
      } else if (data.outcome === 'confirmed') {
        onApplyOutcome(target.id, {
          callStatus: 'Confirmed Attending',
          barrierSummary: data.barrierSummary,
          recommendedAction: data.recommendedAction,
        });
        completionNote = 'Call ended · attendance confirmed.';
      } else if (data.outcome === 'declined_classified') {
        onApplyOutcome(target.id, {
          callStatus: 'Follow-Up Required (Human Callback Queued)',
          barrierCategory: data.barrierCategory ?? 'Other',
          barrierSummary: data.barrierSummary,
          recommendedAction: data.recommendedAction,
          clinicalNurseAlert: data.clinicalNurseAlert,
          humanCoordinatorRequested: true,
        });
        completionNote = `Call ended · barrier: ${data.barrierCategory ?? 'Other'} · follow-up queued.`;
      }
    } catch (error) {
      completionNote = error instanceof Error ? error.message : 'Gemini could not summarize the call.';
    } finally {
      setIsProcessingTurn(false);
    }
    setStatusNote(completionNote);
  };

  /** Typed text or a quick-reply chip: goes to Live if connected, else a Plan B Gemini turn. */
  const sendPatientText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isProcessingTurn) return;
    if (voiceMode === 'gemini-live' && wsRef.current?.readyState === WebSocket.OPEN) {
      const typedLine: TranscriptLine = { id: `pat-txt-${Date.now()}`, speaker: 'Patient', text: trimmed, timestamp: nowTime() };
      pendingTypedLiveLineRef.current = typedLine;
      onAppendTranscript(activePatientRef.current.id, typedLine);
      micSendEnabledRef.current = false;
      wsRef.current.send(JSON.stringify({ type: 'text', text: trimmed }));
      return;
    }
    if (!callActiveRef.current) {
      if (activeCallPatientId) return;
      await startTurnBasedCall(activePatientRef.current, undefined, { listen: false });
    }
    await evaluateTurnWithBackend(activePatientRef.current, trimmed);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualInput.trim();
    if (!trimmed) return;
    setManualInput('');
    await sendPatientText(trimmed);
  };

  const regionMeta = FOCUS_REGIONS[patient.regionId];
  const waveActive = isLiveCalling || isAiSpeaking || micActive;
  const { riskBreakdown } = patient;
  const riskFactors = [
    ['Stage', riskBreakdown.pathwayUrgencyPoints, 28, Microscope],
    ['Age + G8', riskBreakdown.ageFrailtyPoints, 20, HeartPulse],
    ['Distance', riskBreakdown.distanceWeatherPoints, 24, Route],
    ['Access', riskBreakdown.equityLanguagePoints, 16, Languages],
    ['Missed calls', riskBreakdown.historyMissedPoints, 6, PhoneMissed],
    ['Timing', riskBreakdown.appointmentTimingPoints, 15, CalendarClock],
  ] as const;
  const stageIndex = PATHWAY_STEPS.findIndex((s) => s.stage === patient.pathwayStage);
  const voiceLabel =
    voiceMode === 'gemini-live'
      ? 'Live'
      : voiceMode === 'web-speech'
        ? 'Plan B'
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
                onChange={(e) => { setSearchQuery(e.target.value); setQueuePage(1); }}
                placeholder="Search"
                aria-label="Search patient, municipality, or ID"
                className="min-h-11 w-full rounded-full border border-cc-line bg-white pl-12 pr-4 text-base text-black placeholder:text-cc-muted focus:border-cc-blue focus:outline-none"
              />
            </div>

            <select
              value={regionFilter}
              onChange={(e) => { setRegionFilter(e.target.value as FocusRegionId | 'ALL'); setQueuePage(1); }}
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
              onChange={(e) => { setStageFilter(e.target.value as PathwayStage | 'ALL'); setQueuePage(1); }}
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
              onChange={(e) => { setTierFilter(e.target.value as RiskTier | 'ALL'); setQueuePage(1); }}
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
              onChange={(e) => { setStatusFilter(e.target.value as CallStatus | 'ALL'); setQueuePage(1); }}
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
          ref={queueListRef}
          className={`min-h-0 flex-1 divide-y divide-cc-line ${
            detailsOpen ? 'clinical-scroll overflow-y-auto' : ''
          }`}
        >
          {page.items.length === 0 && <p className="p-5 text-base text-cc-muted">No patients match these filters.</p>}
          {page.items.map((p) => {
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
                    {p.id === FEATURED_DEMO_PATIENT_ID && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-cc-blue-soft px-3 py-1 text-sm font-medium text-cc-blue">
                        <Pin aria-hidden="true" className="h-3.5 w-3.5" />
                        Demo
                      </span>
                    )}
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
        <nav className="patient-pagination" aria-label="Patient pages">
          <button type="button" disabled={page.page === 1} onClick={() => setQueuePage(page.page - 1)}>Previous</button>
          <span role="status">Page {page.page} of {page.pageCount}</span>
          <button type="button" disabled={page.page === page.pageCount} onClick={() => setQueuePage(page.page + 1)}>Next</button>
        </nav>
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
                <span className="ml-2 rounded-full bg-cc-surface px-3 py-1 text-sm font-medium text-black">Weights: assumption</span>
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
            {!activeCallPatientId ? (
              <button
                type="button"
                onClick={handleStartCall}
                disabled={isConnecting || isProcessingTurn}
                aria-label={callMode === 'live' ? 'Call patient with Gemini Live voice' : 'Call patient, turn-based (Plan B)'}
                className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full bg-cc-blue px-5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Phone aria-hidden="true" className="h-5 w-5" />
                {isConnecting ? 'Connecting…' : 'Call patient'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleHangUpAndClassify()}
                aria-label="End call and classify the conversation"
                title="End call · classify transcript"
                className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full bg-cc-red px-5 text-base font-semibold text-white transition-opacity hover:opacity-90"
              >
                <PhoneOff aria-hidden="true" className="h-5 w-5" />
                End call
              </button>
            )}

            <div role="radiogroup" aria-label="Call mode" className="inline-flex rounded-full bg-cc-surface p-1">
              {([
                ['live', 'Voice live', AudioLines, 'Gemini Live: real-time voice'],
                ['turn', 'Turn-based', MessagesSquare, 'Plan B: speak or type, Gemini replies turn by turn'],
              ] as const).map(([mode, label, Icon, hint]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={callMode === mode}
                  disabled={Boolean(activeCallPatientId) || isConnecting}
                  onClick={() => setCallMode(mode)}
                  title={hint}
                  className={`inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full px-4 text-base font-medium transition-colors disabled:cursor-not-allowed ${
                    callMode === mode ? 'bg-white text-black shadow-sm' : 'text-cc-muted hover:text-black'
                  }`}
                >
                  <Icon aria-hidden="true" className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            {patient.humanCoordinatorRequested && (
              <span className="inline-flex min-h-12 items-center gap-2 rounded-full bg-cc-yellow-soft px-5 text-base font-semibold text-black" title="Coordinator follow-up promised">
                <UserCheck aria-hidden="true" className="h-5 w-5" />
                Coordinator
              </span>
            )}

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
        <div ref={transcriptBoxRef} className="clinical-scroll max-h-[480px] min-h-40 flex-1 space-y-3 overflow-y-auto px-5 py-5 sm:px-6 lg:max-h-none lg:px-8">
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
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4" aria-label="Quick replies">
            {quickReplies(activeCallPatientId ? activePatientRef.current : patient).map((sim) => {
              const tone = REPLY_TONE[sim.tone];
              const Icon = REPLY_ICON[sim.id] ?? MessageCircle;
              return (
                <button
                  key={sim.id}
                  type="button"
                  disabled={isProcessingTurn || isConnecting || (Boolean(activeCallPatientId) && !isLiveCalling)}
                  onClick={() => void sendPatientText(sim.utterance)}
                  className={`inline-flex min-h-12 min-w-0 cursor-pointer items-center gap-2 rounded-2xl border px-3 py-1.5 text-left text-base font-medium leading-tight transition-colors disabled:opacity-50 sm:px-4 ${tone}`}
                  title={sim.utterance}
                  aria-label={`Patient reply: ${sim.label}`}
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
              placeholder={voiceMode === 'web-speech' ? 'Type the patient reply (Plan B)' : 'Type reply'}
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
