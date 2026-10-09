/**
 * URLs que saem no payload da API: `rtmpUrl`, `playbackUrl` e `watchUrl`.
 *
 * Quem publica (OBS) e quem assiste (player) quase nunca usam o mesmo nome: o
 * OBS costuma publicar num endereco interno (LAN/VM) e o player precisa de um
 * nome publico com TLS — senao o browser bloqueia o HLS por mixed content.
 * Por isso cada URL tem a sua env, e o default preserva o comportamento antigo
 * (tudo em `RTMP_INGEST_HOST`):
 *
 *   PUBLIC_RTMP_BASE_URL      rtmp://app.exemplo.com:1935   (OBS)
 *   PUBLIC_PLAYBACK_BASE_URL  https://live.exemplo.com      (HLS)
 *   PUBLIC_API_BASE_URL       https://ingest.exemplo.com    (watchUrl)
 *
 * Modulo puro: so le env. Nada aqui sobe processo, abre socket ou toca disco.
 */

export function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getEnvUrl(name: string, fallbackScheme: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw ? normalizeBaseUrl(raw, fallbackScheme) : undefined;
}

/**
 * Aceita a env com ou sem esquema: `app.exemplo.com:1935` sozinho seria lido
 * pelo `URL` como esquema, nao como host. Tambem tira a barra final, pra nao
 * gerar `//live/...` na hora de compor o path.
 */
export function normalizeBaseUrl(value: string, fallbackScheme = "http"): string {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `${fallbackScheme}://${trimmed}`;
}

/** Host que entra nas URLs quando nenhuma das envs PUBLIC_* esta setada. */
export function getIngestHost(): string {
  return process.env.RTMP_INGEST_HOST ?? "localhost";
}

export function getIngestPort(): number {
  return getEnvNumber("RTMP_INGEST_PORT", 1935);
}

export function getHttpPort(): number {
  return getEnvNumber("RTMP_HTTP_PORT", 8000);
}

export function getIngestApiPort(): number {
  return getEnvNumber("INGEST_API_PORT", 8081);
}

export function getAppName(): string {
  return process.env.RTMP_APP_NAME ?? "live";
}

/** Origem RTMP: o campo `Server` do OBS. */
export function getRtmpBaseUrl(): string {
  return getEnvUrl("PUBLIC_RTMP_BASE_URL", "rtmp") ?? `rtmp://${getIngestHost()}:${getIngestPort()}`;
}

/** Origem do HLS. Use `https://` quando o player roda numa pagina https. */
export function getPlaybackBaseUrl(): string {
  return getEnvUrl("PUBLIC_PLAYBACK_BASE_URL", "http") ?? `http://${getIngestHost()}:${getHttpPort()}`;
}

/** Origem publica da API (player `/watch`, links fora da LAN). */
export function getApiBaseUrl(): string {
  return getEnvUrl("PUBLIC_API_BASE_URL", "http") ?? `http://${getIngestHost()}:${getIngestApiPort()}`;
}

export function getIngestRtmpUrl(): string {
  return `${getRtmpBaseUrl()}/${getAppName()}`;
}

export function getPlaybackUrl(streamKey: string): string {
  return `${getPlaybackBaseUrl()}/${getAppName()}/${streamKey}/index.m3u8`;
}

export function getWatchUrl(): string {
  return `${getApiBaseUrl()}/watch`;
}
