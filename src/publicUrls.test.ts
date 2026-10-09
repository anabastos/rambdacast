import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  getIngestRtmpUrl,
  getPlaybackUrl,
  getWatchUrl,
  normalizeBaseUrl
} from "./publicUrls";

/** Envs que estes testes mexem — todas restauradas no fim de cada teste. */
const MANAGED = [
  "RTMP_INGEST_HOST",
  "RTMP_INGEST_PORT",
  "RTMP_HTTP_PORT",
  "RTMP_APP_NAME",
  "INGEST_API_PORT",
  "RTMP_MEDIA_ROOT",
  "PUBLIC_RTMP_BASE_URL",
  "PUBLIC_PLAYBACK_BASE_URL",
  "PUBLIC_API_BASE_URL"
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const name of MANAGED) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of MANAGED) {
    if (saved[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = saved[name];
    }
  }
});

const KEY = "ac92bab8571146429d95bd3845ba48cc";

describe("defaults (nada de PUBLIC_* setado)", () => {
  it("monta as tres URLs a partir de RTMP_INGEST_HOST", () => {
    process.env.RTMP_INGEST_HOST = "192.168.15.9";

    assert.equal(getIngestRtmpUrl(), "rtmp://192.168.15.9:1935/live");
    assert.equal(
      getPlaybackUrl(KEY),
      `http://192.168.15.9:8000/live/${KEY}/index.m3u8`
    );
    assert.equal(getWatchUrl(), "http://192.168.15.9:8081/watch");
  });

  it("cai em localhost sem RTMP_INGEST_HOST (comportamento do README)", () => {
    assert.equal(getIngestRtmpUrl(), "rtmp://localhost:1935/live");
  });

  it("respeita RTMP_APP_NAME e as portas", () => {
    process.env.RTMP_INGEST_HOST = "nas";
    process.env.RTMP_APP_NAME = "cast";
    process.env.RTMP_INGEST_PORT = "1936";
    process.env.RTMP_HTTP_PORT = "8001";
    process.env.INGEST_API_PORT = "8082";

    assert.equal(getIngestRtmpUrl(), "rtmp://nas:1936/cast");
    assert.equal(getPlaybackUrl(KEY), `http://nas:8001/cast/${KEY}/index.m3u8`);
    assert.equal(getWatchUrl(), "http://nas:8082/watch");
  });
});

describe("PUBLIC_* sobrescreve so a URL que ela governa", () => {
  it("playback publico em https, rtmp continua na LAN (o caso do NAS)", () => {
    process.env.RTMP_INGEST_HOST = "192.168.15.9";
    process.env.PUBLIC_PLAYBACK_BASE_URL = "https://live.portellolabs.co";
    process.env.PUBLIC_API_BASE_URL = "https://ingest.portellolabs.co";

    assert.equal(getIngestRtmpUrl(), "rtmp://192.168.15.9:1935/live");
    assert.equal(
      getPlaybackUrl(KEY),
      `https://live.portellolabs.co/live/${KEY}/index.m3u8`
    );
    assert.equal(getWatchUrl(), "https://ingest.portellolabs.co/watch");
  });

  it("rtmp publico com porta explicita", () => {
    process.env.PUBLIC_RTMP_BASE_URL = "rtmp://app.portellolabs.co:1935";

    assert.equal(getIngestRtmpUrl(), "rtmp://app.portellolabs.co:1935/live");
  });

  it("aceita valor sem esquema e assume o esquema da URL", () => {
    process.env.PUBLIC_PLAYBACK_BASE_URL = "live.portellolabs.co";
    process.env.PUBLIC_RTMP_BASE_URL = "app.portellolabs.co:1935";

    assert.equal(getPlaybackUrl(KEY), `http://live.portellolabs.co/live/${KEY}/index.m3u8`);
    assert.equal(getIngestRtmpUrl(), "rtmp://app.portellolabs.co:1935/live");
  });

  it("tira barra final pra nao gerar //live", () => {
    process.env.PUBLIC_PLAYBACK_BASE_URL = "https://live.portellolabs.co///";
    process.env.PUBLIC_API_BASE_URL = "https://ingest.portellolabs.co/";

    assert.equal(getPlaybackUrl(KEY), `https://live.portellolabs.co/live/${KEY}/index.m3u8`);
    assert.equal(getWatchUrl(), "https://ingest.portellolabs.co/watch");
  });

  it("valor vazio ou so espaco cai no default", () => {
    process.env.RTMP_INGEST_HOST = "nas";
    process.env.PUBLIC_PLAYBACK_BASE_URL = "   ";

    assert.equal(getPlaybackUrl(KEY), `http://nas:8000/live/${KEY}/index.m3u8`);
  });
});

describe("normalizeBaseUrl", () => {
  it("mantem o esquema quando existe", () => {
    assert.equal(normalizeBaseUrl("https://a.co/"), "https://a.co");
    assert.equal(normalizeBaseUrl("rtmp://a.co:1935"), "rtmp://a.co:1935");
  });

  it("assume o esquema de fallback quando nao existe", () => {
    assert.equal(normalizeBaseUrl("a.co:1935", "rtmp"), "rtmp://a.co:1935");
    assert.equal(normalizeBaseUrl("a.co", "https"), "https://a.co");
  });
});
