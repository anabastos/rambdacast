import { ChildProcess, spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { getAppName, getHttpPort, getIngestApiPort, getIngestPort } from "./publicUrls";

const allowedKeys = new Set<string>();
let started = false;

function getMediaMtxPath(): string {
  return process.env.MEDIAMTX_PATH ?? "/usr/local/bin/mediamtx";
}

function getMediaRoot(): string {
  return process.env.RTMP_MEDIA_ROOT ?? "./media";
}

export function extractStreamKey(streamPath: string): string | null {
  const normalized = streamPath.startsWith("/") ? streamPath : `/${streamPath}`;
  const prefix = `/${getAppName()}/`;
  if (!normalized.startsWith(prefix)) {
    return null;
  }
  return normalized.slice(prefix.length);
}

export function allowStreamKey(streamKey: string): void {
  allowedKeys.add(streamKey);
}

export function revokeStreamKey(streamKey: string): void {
  allowedKeys.delete(streamKey);
}

export function isStreamKeyAllowed(streamKey: string): boolean {
  return allowedKeys.has(streamKey);
}

function getAuthHttpAddress(): string {
  return `http://127.0.0.1:${getIngestApiPort()}/internal/mediamtx/auth`;
}

function createMediaMtxConfigFile(): string {
  const mediaRoot = getMediaRoot();
  if (!existsSync(mediaRoot)) {
    mkdirSync(mediaRoot, { recursive: true });
  }
  const config = [
    "logLevel: info",
    "rtsp: no",
    "hls: yes",
    `hlsAddress: :${getHttpPort()}`,
    "hlsAlwaysRemux: yes",
    "hlsSegmentDuration: 2s",
    "hlsSegmentCount: 6",
    "webrtc: no",
    "srt: no",
    "rtmp: yes",
    `rtmpAddress: :${getIngestPort()}`,
    "authMethod: http",
    `authHTTPAddress: ${getAuthHttpAddress()}`,
    "paths:",
    "  all_others: {}"
  ].join("\n");
  const filename = `mediamtx-${getIngestPort()}-${getHttpPort()}.yml`;
  const configPath = join(tmpdir(), filename);
  writeFileSync(configPath, `${config}\n`, "utf-8");
  return configPath;
}

export function startLocalRtmpServer(): void {
  if (started) {
    return;
  }
  const mediaMtxConfigPath = createMediaMtxConfigFile();
  const mediaMtxPath = getMediaMtxPath();
  const child: ChildProcess = spawn(mediaMtxPath, [mediaMtxConfigPath], {
    stdio: "inherit"
  });
  child.on("error", (error) => {
    console.error("Failed to start MediaMTX:", error);
  });
  child.on("exit", (code, signal) => {
    if (code !== 0) {
      console.error(`MediaMTX exited unexpectedly (code=${code}, signal=${signal ?? "none"})`);
    }
  });
  process.on("exit", () => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  });
  started = true;
}
