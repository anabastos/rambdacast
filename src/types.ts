export type StreamStatus = "idle" | "live" | "ended";

export interface AudioPreset {
  codec: "aac";
  bitrateKbps: number;
  sampleRateHz: number;
  channels: number;
}

export interface StreamSession {
  id: string;
  title: string;
  status: StreamStatus;
  rtmpUrl: string;
  streamKey: string;
  playbackUrl: string;
  provider: "vm";
  recommendedAudio?: AudioPreset;
  startedAt: string;
  endedAt?: string;
}

export interface CreateIngestInput {
  title?: string;
}