import "dotenv/config";

import { randomUUID } from "crypto";
import { join } from "path";

import cors from "cors";
import express from "express";

import {
  allowStreamKey,
  extractStreamKey,
  isStreamKeyAllowed,
  revokeStreamKey,
  startLocalRtmpServer
} from "./localRtmpServer";
import { getIngestRtmpUrl, getPlaybackUrl, getWatchUrl } from "./publicUrls";
import { clearCurrentStream, endCurrentStream, getCurrentStream, setCurrentStream } from "./streamStore";
import { CreateIngestInput, StreamSession } from "./types";

const app = express();
const port = Number(process.env.INGEST_API_PORT ?? 8081);
const ingestApiKey = process.env.INGEST_API_KEY ?? "";

if (!ingestApiKey) {
  throw new Error("Missing INGEST_API_KEY");
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.post("/internal/mediamtx/auth", (req, res) => {
  const action = typeof req.body?.action === "string" ? req.body.action.toLowerCase() : "";
  const streamPath = typeof req.body?.path === "string" ? req.body.path : "";

  if (action !== "publish") {
    return res.status(200).json({ ok: true });
  }

  const streamKey = extractStreamKey(streamPath);
  if (!streamKey || !isStreamKeyAllowed(streamKey)) {
    return res.status(401).json({ message: "Invalid stream key" });
  }

  return res.status(200).json({ ok: true });
});

app.get("/health", (_req, res) => {
  res.json({
    service: "vm-ingest-service",
    status: "ok"
  });
});

app.get("/playback", (_req, res) => {
  const stream = getCurrentStream();
  if (!stream || stream.status !== "live") {
    return res.status(404).json({ message: "No active stream" });
  }

  return res.json({
    title: stream.title,
    status: stream.status,
    playbackUrl: stream.playbackUrl
  });
});

app.get("/watch", (_req, res) => {
  res.sendFile(join(__dirname, "..", "public", "watch.html"));
});

app.use(express.static(join(__dirname, "..", "public")));

/**
 * Nada de sessao ativa sai sem a chave — inclusive o alias `/stream/current`.
 * O `streamKey` do payload publica na live: expor isso e publicar a live.
 */
app.use(["/ingest", "/stream"], (req, res, next) => {
  const apiKey = req.header("x-api-key");
  if (!apiKey || apiKey !== ingestApiKey) {
    return res.status(401).json({ message: "Invalid API key" });
  }

  return next();
});

app.post("/ingest/create", (req, res) => {
  const existing = getCurrentStream();
  if (existing && existing.status === "live") {
    return res.status(409).json({
      message: "A stream is already live",
      stream: existing
    });
  }

  const payload = (req.body ?? {}) as CreateIngestInput;
  const id = randomUUID();
  const streamKey = id.replace(/-/g, "");

  allowStreamKey(streamKey);

  const stream: StreamSession = {
    id,
    title: payload.title ?? "Untitled Stream",
    status: "live",
    rtmpUrl: getIngestRtmpUrl(),
    streamKey,
    playbackUrl: getPlaybackUrl(streamKey),
    watchUrl: getWatchUrl(),
    provider: "vm",
    recommendedAudio: {
      codec: "aac",
      bitrateKbps: 192,
      sampleRateHz: 48000,
      channels: 2
    },
    startedAt: new Date().toISOString()
  };

  setCurrentStream(stream);

  return res.status(201).json(stream);
});

/**
 * A sessao ativa em dois nomes: `/ingest/current` (contrato do world-ingest) e
 * `/stream/current` (o nome da fachada do world-service). Mesmo dado — quem
 * integra chama de um jeito ou do outro.
 */
function currentStreamHandler(_req: express.Request, res: express.Response) {
  const stream = getCurrentStream();
  if (!stream || stream.status !== "live") {
    return res.status(404).json({ message: "No active stream" });
  }

  return res.json(stream);
}

app.get(["/ingest/current", "/stream/current"], currentStreamHandler);

app.post("/ingest/end", (_req, res) => {
  const stream = getCurrentStream();
  if (!stream || stream.status !== "live") {
    return res.status(404).json({ message: "No active stream to end" });
  }

  revokeStreamKey(stream.streamKey);
  const ended = endCurrentStream();
  clearCurrentStream();

  return res.json({
    message: "Stream ended",
    stream: ended
  });
});

app.listen(port, () => {
  startLocalRtmpServer();
  console.log(`vm-ingest-service listening on port ${port}`);
});