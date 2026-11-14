# AGENTS.md

Instructions for coding agents (OpenAI Codex and others) working in this repository.

## Project

CareCatalyzer: a decision-support prototype for equal cancer care across Finland
(Junction 2026, AstraZeneca challenge). A Gemini-powered calling agent phones
synthetic lung-cancer pathway patients, captures why they would miss or cancel an
appointment, classifies the barrier, and feeds it into a regional barrier map and
an intervention simulator.

## Stack

- Frontend: Vite + React 19 + TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), `lucide-react`, `motion`.
- Backend: single Express server in `server.ts` (run with `tsx`), which also mounts Vite in middleware mode during development.
- AI: `@google/genai`.
  - `POST /api/call-turn` and `POST /api/classify-call`: Gemini Flash with a JSON `responseSchema` (`CALL_TURN_SCHEMA`).
  - `WS /api/live-call`: WebSocket proxy to Gemini Live (audio in/out with transcription).
  - `GET /api/health`: reports whether a key is configured and which models are selected.
- Voice fallback: browser Web Speech API (recognition + synthesis) in `src/components/Tab1CallingAgent.tsx` and `src/utils/voiceAudio.ts`.

## Commands

```bash
npm install
cp .env.example .env      # set GEMINI_API_KEY
npm run dev               # tsx server.ts -> http://localhost:3000
npm run lint              # tsc --noEmit (type check)
npm run build             # vite build -> dist/
npx tsx --test tests/     # node:test unit tests
```

A `bun.lock` is committed; `bun install` / `bun run dev` work as well.

## Layout

```
server.ts                       Express + WebSocket server, Gemini prompts and schema
src/App.tsx                     Dashboard shell and shared state (patients, region, weather)
src/components/Tab1CallingAgent.tsx         Calling agent UI (Live voice, speech fallback, transcript)
src/components/Tab2RegionalBarrierMap.tsx   Regional barrier map (Lapland/OYS, North Savo/KYS, Uusimaa/HUS)
src/components/Tab3InterventionSimulator.tsx  Regional support plans / intervention comparison
src/components/SimulationLab.tsx            Policy scenario lab (uses src/utils/policyModel.ts)
src/data/patients.ts            Synthetic patients and focus-region metadata
src/types/careconnect.ts        Shared types (BarrierCategory, PatientRecord, ...)
src/utils/riskEngine.ts         Risk scoring and applying call outcomes to patients
src/utils/simulationEngine.ts   Intervention simulation driven by verified barriers
src/utils/policyModel.ts        Transparent policy model (budget, cars, mobile units, winter)
src/utils/voiceAudio.ts         PCM mic capture / playback, speech synthesis fallback
tests/                          node:test tests for cancellation flow and policy model
public/assets/aistudio/         Finnish National Cancer Strategy 2026-2035 reference PDFs
```

## Conventions

- TypeScript everywhere; imports use explicit `.ts` / `.tsx` extensions (`allowImportingTsExtensions`).
- Keep `GEMINI_API_KEY` server-side only. Never prefix it with `VITE_`, never commit `.env` (it is in `.gitignore`).
- Model names come from `GEMINI_CHAT_MODEL` / `GEMINI_LIVE_MODEL`; do not hard-code new model IDs elsewhere.
- Barrier categories are a fixed set: `Transport`, `Weather`, `Scheduling`, `Accessibility`, `Language`, `Other`. If you change them, update `CALL_TURN_SCHEMA`, `COORDINATOR_SYSTEM_PROMPT`, `normalizeCategory` in `server.ts` and `src/types/careconnect.ts` together.
- The cancellation workflow (ask for the reason exactly once, then cancel) is covered by `tests/cancellation.test.ts`; keep it passing.
- On Gemini errors, show an error to the user; do not substitute scripted AI answers.
- Data is synthetic only. Do not add real patient data or personal information.
- Before finishing a change: run `npm run lint` and the tests.
