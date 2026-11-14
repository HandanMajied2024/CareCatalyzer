import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
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
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [patient.transcript.length]);

  const cleanupMediaAndSockets = () => {
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

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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

      if (data.outcome === 'continue_probe') {
        setStatusNote(
          'AI Probing: Refused vague cancellation — keeping appointment held until barrier is clarified.'
        );
      } else if (data.outcome === 'confirmed') {
        onApplyOutcome(targetPatient.id, {
          callStatus: 'Confirmed Attending',
          barrierCategory: null,
          barrierSummary: data.barrierSummary ?? 'Patient confirmed attendance.',
          recommendedAction: data.recommendedAction,
          clinicalNurseAlert: false,
        });
        voiceAudio.playOutcomeTone('confirmed');
        setStatusNote('Confirmed Attending · Risk score lowered (-14 pts) · Goal 3 on track.');
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
      rec.onerror = () => {
        setMicActive(false);
        setVoiceMode('guided');
        setStatusNote('Mic unavailable — use Simulated Patient Voice Replies or text box below.');
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
    onStartCall(target.id);
    voiceAudio.playDialTone();
    setStatusNote('Connecting microphone & Gemini Live Voice (gemini-3.8-live)...');

    let micStream: MediaStream | null = null;
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = micStream;
      }
    } catch {
      micStream = null;
    }

    if (!micStream) {
      startWebSpeechFallback(target);
      return;
    }

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
        };

        if (msg.type === 'ready') {
          setVoiceMode('gemini-live');
          setStatusNote('Gemini Live (gemini-3.8-live) bidirectional voice active.');
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AudioCtx && micStreamRef.current) {
            const ctx = new AudioCtx({ sampleRate: 16000 });
            micCtxRef.current = ctx;
            const src = ctx.createMediaStreamSource(micStreamRef.current);
            const proc = ctx.createScriptProcessor(4096, 1, 1);
            micProcRef.current = proc;
            proc.onaudioprocess = (e) => {
              if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
              const pcmBase64 = float32ToPcm16Base64(e.inputBuffer.getChannelData(0));
              wsRef.current.send(JSON.stringify({ type: 'audio', data: pcmBase64 }));
            };
            src.connect(proc);
            proc.connect(ctx.destination);
            setMicActive(true);
          }
          return;
        }

        if (msg.type === 'audio' && msg.data) {
          setIsAiSpeaking(true);
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
          if (liveUserBufferRef.current.trim()) {
            onAppendTranscript(activePatientRef.current.id, {
              id: `pat-live-${Date.now()}`,
              speaker: 'Patient',
              text: liveUserBufferRef.current.trim(),
              timestamp: nowTime(),
            });
            liveUserBufferRef.current = '';
          }
          if (liveAiBufferRef.current.trim()) {
            onAppendTranscript(activePatientRef.current.id, {
              id: `ai-live-${Date.now()}`,
              speaker: 'AI Coordinator',
              text: liveAiBufferRef.current.trim(),
              timestamp: nowTime(),
            });
            liveAiBufferRef.current = '';
          }
          return;
        }

        if (msg.type === 'interrupted') {
          voiceAudio.stopLivePlayback();
          setIsAiSpeaking(false);
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
        if (resp.ok) {
          const data = (await resp.json()) as CallTurnApiResponse;
          if (data.outcome === 'confirmed') {
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
      } finally {
        setIsProcessingTurn(false);
      }
    }

    cleanupMediaAndSockets();
    setVoiceMode('idle');
    onEndCall();
    setStatusNote('Call finished.');
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
      onAppendTranscript(patient.id, {
        id: `pat-txt-${Date.now()}`,
        speaker: 'Patient',
        text: trimmed,
        timestamp: nowTime(),
      });
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
  const projectedDays = patient.daysElapsed + patient.daysUntilAppointment;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[44fr_56fr] gap-4 items-stretch">
      {/* Left: Filterable Lung Cancer Fast-Track Triage Queue */}
      <section className="bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden h-[700px] shadow-2xs">
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

          <div className="grid grid-cols-2 gap-1.5">
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
              <option value="No Pick-Up">No Pick-Up</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto clinical-scroll divide-y divide-slate-200">
          {filteredQueue.map((p) => {
            const isSelected = p.id === patient.id;
            const isRecent = p.id === recentlyUpdatedId;
            const tMeta = getTierMeta(p.riskTier);

            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectPatient(p.id)}
                className={`w-full text-left px-4 py-2.5 transition-colors cursor-pointer ${
                  isRecent
                    ? 'bg-sky-50'
                    : isSelected
                      ? 'bg-sky-50/80 ring-1 ring-inset ring-sky-200'
                      : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
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

                  <div className="text-right shrink-0">
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
                </div>

                <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
                  <span
                    className={
                      p.callStatus === 'Confirmed Attending'
                        ? 'text-emerald-700 font-semibold'
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
                  {p.goal3AtRisk && (
                    <span className="text-orange-700 font-mono tabular-nums font-semibold">
                      Goal 3 Breach Risk
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Right: Outbound AI Voice Console + Human-in-the-Loop Safeguards */}
      <section className="bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden h-[700px] shadow-2xs">
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
                <span aria-hidden="true" className="text-slate-400">·</span>
                <span
                  className={`inline-flex items-center gap-1 font-mono tabular-nums text-[11px] font-semibold ${
                    patient.goal3AtRisk ? 'text-orange-700' : 'text-emerald-700'
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  {projectedDays}d / {patient.targetDaysTotal}d Goal 3 Target{' '}
                  {patient.goal3AtRisk ? '(Delay Risk)' : '(Within Target)'}
                </span>
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

          {/* Score Breakdown Strip */}
          <div className="mt-2 pt-2 border-t border-slate-200 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span>
              Pathway/Stage{' '}
              <strong className="font-mono tabular-nums text-slate-800">
                {patient.riskBreakdown.pathwayUrgencyPoints}
              </strong>
            </span>
            <span>·</span>
            <span>
              Age/G8{' '}
              <strong className="font-mono tabular-nums text-slate-800">
                {patient.riskBreakdown.ageFrailtyPoints}
              </strong>
            </span>
            <span>·</span>
            <span>
              Distance/Winter{' '}
              <strong className="font-mono tabular-nums text-slate-800">
                {patient.riskBreakdown.distanceWeatherPoints}
              </strong>
            </span>
            <span>·</span>
            <span>
              Equity/Access{' '}
              <strong className="font-mono tabular-nums text-slate-800">
                {patient.riskBreakdown.equityLanguagePoints}
              </strong>
            </span>
            <span>·</span>
            <span>
              History/Goal 3{' '}
              <strong className="font-mono tabular-nums text-slate-800">
                {patient.riskBreakdown.historyMissedPoints}
              </strong>
            </span>
          </div>
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
                  Start Live Mic Call
                </button>
                <button
                  type="button"
                  onClick={handleStartGuidedCall}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 font-medium text-xs transition-colors cursor-pointer"
                >
                  <Phone className="w-3.5 h-3.5 text-sky-700" />
                  Simulate Outbound Call
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleHangUpAndClassify}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                End &amp; Finalize Call
              </button>
            )}

            <button
              type="button"
              onClick={() => onRequestHumanCoordinator(patient.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
                patient.humanCoordinatorRequested
                  ? 'bg-amber-50 border-amber-300 text-amber-900 font-semibold'
                  : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700'
              }`}
            >
              <PhoneCall className="w-3.5 h-3.5 text-amber-600" />
              {patient.humanCoordinatorRequested
                ? 'Human Care Coordinator Queued'
                : 'Request Human Care Coordinator'}
            </button>

            <div className="ml-auto flex items-center gap-1.5 text-[11px] font-mono text-slate-500">
              {micActive ? <Mic className="w-3.5 h-3.5 text-emerald-600" /> : <MicOff className="w-3.5 h-3.5" />}
              <span>
                {voiceMode === 'gemini-live'
                  ? 'gemini-3.8-live'
                  : voiceMode === 'web-speech'
                    ? 'WebSpeech'
                    : voiceMode === 'guided'
                      ? 'Guided AI'
                      : 'Standby'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 px-2.5 py-1.5 rounded bg-slate-50 border border-slate-200">
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
                  <strong>Safeguard Action:</strong> {patient.recommendedAction}
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
        <div className="flex-1 min-h-0 overflow-y-auto clinical-scroll px-4 py-2.5 space-y-2 bg-white">
          {patient.transcript.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 py-4 border border-dashed border-slate-300 rounded-md bg-slate-50/50">
              <Sparkles className="w-5 h-5 text-sky-700 mb-1.5" />
              <p className="text-xs font-medium text-slate-800">
                Ready for Lung Fast-Track Outreach: {patient.name}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-md">
                Start a Live Mic Call or click any "Simulate Patient Voice Reply" scenario below.
                Declined appointments are never auto-cancelled—they route directly to human Care
                Coordinator follow-up.
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
