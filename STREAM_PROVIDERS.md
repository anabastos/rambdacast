# Stream Providers - Local e VM

Este documento descreve como usar os providers de stream do world-service.

## Ingest RTMP local (OBS)

O provider local sobe ingest RTMP real no proprio world-service.

### Pre-requisitos

- STREAM_PROVIDER=local
- RTMP_INGEST_PORT=1935
- RTMP_APP_NAME=live
- RTMP_HTTP_PORT=8000
- RTMP_PLAYBACK_PROTOCOL=hls

### Fluxo

1. Front chama POST /stream/create com token Firebase.
2. Backend retorna:
   - rtmpUrl (exemplo rtmp://localhost:1935/live)
   - streamKey
   - playbackUrl (exemplo http://localhost:8000/live/<streamKey>/index.m3u8)
3. No OBS:
   - Service: Custom
   - Server: rtmpUrl
   - Stream Key: streamKey
4. Clique Start Streaming.
5. Front toca playbackUrl.
6. Para encerrar, chame POST /stream/end.

Observacao: o ingest local aceita apenas stream keys criadas por POST /stream/create.

## Provider VM (hibrido para producao)

Use STREAM_PROVIDER=vm no backend hosteado para delegar create/current/end para uma VM de ingest.

### Variaveis

- VM_INGEST_API_BASE_URL (exemplo: https://ingest.your-domain.com)
- VM_INGEST_API_KEY (secret compartilhado entre hosteado e VM)
- VM_INGEST_TIMEOUT_MS (default 10000)

### Contratos esperados na VM

- POST /ingest/create -> retorna stream (ou { stream: ... })
- GET /ingest/current -> retorna stream atual (ou { stream: ... })
- POST /ingest/end -> encerra stream ativa

### Quando STREAM_PROVIDER=vm

- POST /stream/create chama POST /ingest/create na VM
- GET /stream/current chama GET /ingest/current na VM
- POST /stream/end chama POST /ingest/end na VM
