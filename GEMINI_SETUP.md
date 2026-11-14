# Gemini setup

Create `/home/hazemdhaouadi/CareCatalyzer/.env` with:

```dotenv
GEMINI_API_KEY=your_google_ai_studio_key
```

From the project directory, restart the server with `npm run dev`, then open
`http://localhost:3000`. The server reads `.env` at startup. It is ignored by Git;
the key is never sent to the browser. `.env.example` contains optional model overrides.

Chat replies and conversation classification use Gemini 3.8 Flash. Microphone
conversations use Gemini 3.8 Live. If Live is unavailable, browser speech recognition
can feed the same Gemini chat endpoint. Missing keys or failed chat requests show an
error instead of substituting scripted answers. Sample reply buttons supply test
patient input; the no-answer button records a simulated unanswered call locally.

`GET /api/health` reports whether a key is configured and the selected model names;
it does not verify that the key is valid or has sufficient quota. Test a message
and microphone conversation after configuring the key.

Model reference: https://aistudio.google.com/docs/models
Live API reference: https://aistudio.google.com/docs/live-api
