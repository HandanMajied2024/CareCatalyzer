# CareCatalyzer

**Equal cancer care across Finland.** Built at Junction 2026 for the AstraZeneca challenge "Equal Care Across Finland".

Patients in Lapland can live hundreds of kilometres from the nearest cancer centre. When they miss or cancel an appointment, the reason (no bus, a snowstorm, a work shift, a letter they could not read) is rarely recorded, so the region cannot fix it. CareCatalyzer closes that gap: a Gemini-powered calling agent phones patients on the lung cancer fast-track pathway, asks why they cannot attend, classifies the barrier, and feeds it straight into a regional barrier map and an intervention simulator. Coordinators see *why* care is unequal, region by region, and can test which fix (transport, mobile units, extra capacity) helps the most patients for the budget. It supports Goal 3 of Finland's National Cancer Strategy 2026-2035.

## Features

- **Calling agent.** Live voice call (Gemini Live) or text call with a synthetic patient. The agent confirms the appointment, asks for the cancellation reason exactly once, classifies the barrier (`Transport`, `Weather`, `Scheduling`, `Accessibility`, `Language`, `Other`) and raises a nurse alert for acute symptoms.
- **Regional Barrier Map.** Verified barriers aggregated for three focus regions: Lapland / OYS North, North Savo / KYS East, Uusimaa / HUS South.
- **Intervention Simulator.** Compares regional support plans using the barriers captured by the calls, the selected region and severe-weather conditions.
- **Simulation Lab.** Transparent policy model: budget, months, extra hospital slots, transport cars, mobile units and winter conditions translate into patients treated, access, travel distance and waiting time.
- **Risk engine.** Each call outcome updates the patient's risk score and flags patients whose Goal 3 timeframe is at risk.

## How to run

Requirements: Node.js 22+ (or Bun) and a Google AI Studio API key.

```bash
npm install
cp .env.example .env     # then set GEMINI_API_KEY=...
npm run dev              # http://localhost:3000
```

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | (required) | Google AI Studio key, used only on the server |
| `GEMINI_CHAT_MODEL` | `gemini-3.8-flash` | Chat turns and classification |
| `GEMINI_LIVE_MODEL` | `gemini-3.8-live` | Live voice calls |
| `PORT` | `3000` | Server port |

Other scripts: `npm run lint` (type check), `npm run build` (production build), `npx tsx --test tests/` (unit tests). `GET /api/health` shows whether a key is configured. See [GEMINI_SETUP.md](GEMINI_SETUP.md) for details.

## Built with Gemini

**Problem.** Cancellation and no-show reasons in cancer pathways are lost in free-text phone calls. Without structured reasons, regions cannot see whether patients are blocked by distance, weather, scheduling or language.

**How Gemini is integrated** (all calls run server-side in `server.ts` via `@google/genai`):

- **Gemini Live (`gemini-3.8-live`)** powers the voice call. The browser streams 16 kHz PCM microphone audio over a WebSocket (`/api/live-call`) to the server, which holds the Live session and streams back audio (prebuilt voice) plus input and output transcriptions. Automatic voice-activity detection with barge-in lets the patient interrupt the agent, and the patient's name, municipality and appointment type are passed as custom transcription vocabulary.
- **Gemini Flash (`gemini-3.8-flash`) with structured output** handles each text turn (`/api/call-turn`) and the end-of-call classification (`/api/classify-call`). A JSON `responseSchema` forces every answer into `aiReply`, `outcome`, `needsProbe`, `barrierCategory`, `barrierSummary`, `recommendedAction` and `clinicalNurseAlert`, so a conversation becomes a typed record that updates the patient's risk score, the regional map and the simulator directly.
- **Shared safeguards.** Both paths use the same coordinator system prompt: one question at a time, ask for the reason exactly once before cancelling, fixed barrier taxonomy, urgent nurse triage on acute symptoms. If Live is unavailable, browser speech recognition feeds the same Gemini Flash endpoint. If Gemini fails, the app shows an error instead of scripted answers.

**What is novel.** The AI call is not a chatbot bolted onto a dashboard: every conversation produces structured equity data. One patient saying "the roads are closed by snow" moves a Lapland weather barrier on the map and changes which intervention the simulator recommends.

**Why Gemini.** One SDK gives both low-latency native audio conversation (Live API, with transcription and interruption handling) and schema-constrained JSON output (Flash), so voice and data share one prompt and one barrier taxonomy. Flash keeps per-call cost and latency low enough for routine outreach calls.

## Built with Codex

The team used OpenAI Codex as its coding agent during the hackathon to build and iterate on the frontend, the server and the simulation models. [`AGENTS.md`](AGENTS.md) holds the agent instructions for this repository (stack, commands, layout, conventions).

<!-- TODO: add Codex session screenshots -->

## Data

All patients, appointments and call transcripts are **synthetic**. The app contains no real patient data or personal information. Regional figures in the policy model are illustrative demo values, not official statistics. The reference documents in `public/assets/aistudio/` are the public Finnish National Cancer Strategy 2026-2035 and its implementation roadmap.

<!-- TODO: add demo video / live demo link -->

## Team

CareCatalyst: Handan Majied, Hazem Dhaouadi, Youcef Jerbi.

## License

[MIT](LICENSE)
