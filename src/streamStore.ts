import { StreamSession } from "./types";

let currentStream: StreamSession | null = null;

export function getCurrentStream(): StreamSession | null {
  return currentStream;
}

export function setCurrentStream(stream: StreamSession): void {
  currentStream = stream;
}

export function endCurrentStream(): StreamSession | null {
  if (!currentStream) {
    return null;
  }

  currentStream = {
    ...currentStream,
    status: "ended",
    endedAt: new Date().toISOString()
  };

  return currentStream;
}

export function clearCurrentStream(): void {
  currentStream = null;
}