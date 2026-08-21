# Configuração do OBS para transmitir no Interplanar

## Antes de começar

Você precisa de uma stream key ativa. Peça para o time técnico ou crie via API:

```bash
POST /stream/create
```

A resposta vai trazer `rtmpUrl` e `streamKey`.

---

## Configurar no OBS

Abra o OBS → **Settings** → **Stream**

| Campo | Valor |
|---|---|
| **Service** | Custom |
| **Server** | `rtmp://ingest.interplanar.co:1935/live` |
| **Stream Key** | (a key que você recebeu) |

---

## Configurar áudio e vídeo

Vá em **Settings** → **Output** → modo **Advanced**

**Vídeo (aba Streaming):**
- Encoder: `x264` ou `NVENC H.264` (se tiver placa NVIDIA)
- Keyframe interval: `2`

**Áudio (aba Audio):**
- Audio Bitrate: `192`

Vá em **Settings** → **Audio**

- Sample Rate: `48 kHz`
- Channels: `Stereo`

---

## Iniciar

Clique **Start Streaming** no OBS.

Aguarde alguns segundos e abra o player no site para confirmar que está chegando.

---

## Encerrar

Clique **Stop Streaming** no OBS e avise o time para encerrar a sessão via API (`POST /stream/end`).
