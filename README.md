# rambdacast (world-ingest-vm)

Serviço de ingest de live streaming (RTMP → HLS). Roda como um processo Node.js de longa duração numa VM, que sobe e gerencia o [MediaMTX](https://github.com/bluenviron/mediamtx) como processo filho para receber o stream do OBS via RTMP e servi-lo como HLS para o navegador.

## Documentação

| Documento | Conteúdo |
|---|---|
| [STREAMING_ARCHITECTURE.md](STREAMING_ARCHITECTURE.md) | Arquitetura do pipeline, motivação de cada componente, fluxo ponta a ponta e latência |
| [openapi.yaml](openapi.yaml) | Spec OpenAPI das rotas HTTP deste serviço |
| [OBS_SETUP.md](OBS_SETUP.md) | Passo a passo de configuração do OBS para transmitir |
| [STREAM_PROVIDERS.md](STREAM_PROVIDERS.md) | Como o world-service consome este ingest (providers `local` e `vm`) |
| [VM_DEPLOY_GCP.md](VM_DEPLOY_GCP.md) | Deploy via Instance Template no Google Cloud |
| [NAS_DEPLOY_DOCKER.md](NAS_DEPLOY_DOCKER.md) | Alternativa de deploy via Docker num NAS |

## Como funciona (resumo)

```
OBS --RTMP--> MediaMTX (spawnado por este serviço) --HLS--> Navegador
                    ↑
                    │ callback de auth
                    │
         API HTTP deste serviço (Express)
```

- Este serviço expõe uma API HTTP (Express) para criar/consultar/encerrar uma sessão de live e gera a stream key.
- O MediaMTX é iniciado como subprocesso, configurado via arquivo YAML gerado em runtime.
- Toda tentativa de publish no MediaMTX é validada por um callback HTTP interno (`/internal/mediamtx/auth`) contra as stream keys liberadas em memória.
- Só existe **uma live ativa por vez** (estado mantido em memória, sem banco de dados).

## Requisitos

- Node.js 18+
- [MediaMTX](https://github.com/bluenviron/mediamtx) instalado no host, com o binário acessível no caminho configurado em `MEDIAMTX_PATH`

## Setup

```bash
npm install
cp .env.example .env   # ajustar valores conforme o ambiente
npm run dev             # desenvolvimento (tsx watch)
```

Build e execução em produção:

```bash
npm run build
npm start
```

## Variáveis de ambiente

| Variável | Descrição | Default |
|---|---|---|
| `INGEST_API_PORT` | Porta da API HTTP deste serviço | `8081` |
| `INGEST_API_KEY` | API key exigida (header `x-api-key`) para as rotas `/ingest/*` | — (obrigatória) |
| `RTMP_INGEST_HOST` | Hostname público usado para montar `rtmpUrl`/`playbackUrl` | `localhost` |
| `RTMP_INGEST_PORT` | Porta RTMP do MediaMTX | `1935` |
| `RTMP_APP_NAME` | Nome da "app" RTMP (path base, ex.: `live`) | `live` |
| `RTMP_HTTP_PORT` | Porta HTTP do MediaMTX (serve o HLS) | `8000` |
| `MEDIAMTX_PATH` | Caminho do binário do MediaMTX | `/usr/local/bin/mediamtx` |
| `RTMP_MEDIA_ROOT` | Diretório de mídia usado pelo MediaMTX | `./media` |
| `OBS_AUDIO_*` | Preset de áudio recomendado ao streamer (informativo, sem transcode no servidor) | ver `.env.example` |

## API

Spec completa em formato OpenAPI: [openapi.yaml](openapi.yaml) (pode ser aberta em [editor.swagger.io](https://editor.swagger.io) ou em qualquer extensão OpenAPI da IDE).

Todas as rotas sob `/ingest` exigem o header `x-api-key: <INGEST_API_KEY>`.

### `POST /ingest/create`
Cria uma nova sessão de live (falha com `409` se já houver uma ao vivo). Gera `streamKey`, `rtmpUrl` e `playbackUrl`.

```json
// body (opcional)
{ "title": "Nome da live" }
```

#### Conectando pelo OBS após o `create`

A resposta do `POST /ingest/create` traz algo assim:

```json
{
  "id": "a1b2c3d4-...",
  "rtmpUrl": "rtmp://ingest.your-nas-dns.example:1935/live",
  "streamKey": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  "playbackUrl": "http://ingest.your-nas-dns.example:8000/live/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6/index.m3u8",
  ...
}
```

No OBS, em **Configurações → Transmissão (Stream)**:

1. Serviço: `Personalizado...` (Custom)
2. Servidor: cole o valor de `rtmpUrl` (ex.: `rtmp://ingest.your-nas-dns.example:1935/live`)
3. Chave de transmissão (Stream Key): cole o valor de `streamKey`

Em **Configurações → Saída (Output) → Áudio**, use o preset recomendado (`recommendedAudio` na resposta / variáveis `OBS_AUDIO_*` do `.env`): AAC, 192 kbps, 48 kHz, estéreo. O servidor não faz transcode — o que o OBS envia é o que chega ao espectador.

Clique em **Iniciar Transmissão**. O OBS abre a conexão RTMP, o MediaMTX chama o callback `/internal/mediamtx/auth` para validar a `streamKey` e, se autorizada, aceita o publish e começa a gerar os segmentos HLS.

Para assistir, aponte o player (`hls.js` ou `<video>` nativo) para o `playbackUrl` retornado. Leva ~6–12s para o primeiro frame aparecer (buffer de segmentos HLS — ver [STREAMING_ARCHITECTURE.md](STREAMING_ARCHITECTURE.md)).

Se o OBS não conectar, verifique:
- A `streamKey` usada é a mais recente (uma nova `create` gera uma key diferente da anterior).
- A porta RTMP (`RTMP_INGEST_PORT`, default `1935`) está acessível/aberta no firewall da VM.
- Não há outra live já ativa (`POST /ingest/create` retorna `409` nesse caso — encerre com `/ingest/end` antes de criar outra).

#### Assistindo a live num navegador

O serviço já expõe uma página de player pronta em `http://<host>:<INGEST_API_PORT>/watch` (ex.: `http://localhost:8081/watch`).

- A página consulta `GET /playback` (rota **pública**, sem API key) a cada 5s para descobrir se há live ativa e qual o `playbackUrl` atual.
- Assim que detecta uma live, monta o player com `hls.js` (ou HLS nativo no Safari/iOS) e começa a reproduzir.
- Não exige nenhuma configuração — basta ter criado a live via `POST /ingest/create` e o OBS estar transmitindo.

Isso é só um viewer de referência para testar rapidamente; o frontend "de verdade" (ex.: world-service) deve consumir o `playbackUrl` retornado por `/ingest/current` e montar o player como preferir.

### `GET /ingest/current`
Retorna a sessão ativa, ou `404` se não houver live em andamento.

### `POST /ingest/end`
Encerra a live ativa e revoga a stream key.

### `GET /health`
Health check simples.

### `POST /internal/mediamtx/auth`
Callback interno usado pelo MediaMTX para autorizar publish. Não deve ser chamado diretamente por clientes externos.

## Estrutura do código

```
src/
  index.ts            # API Express, rotas de ingest e callback de auth do MediaMTX
  localRtmpServer.ts   # gera a config do MediaMTX, sobe/gerencia o subprocesso, controla stream keys
  streamStore.ts       # estado em memória da sessão de live atual
  types.ts             # tipos compartilhados (StreamSession, etc.)
```

## Observações

- O estado da live (stream ativa, keys liberadas) é **em memória** — reiniciar o processo perde a sessão atual.
- Latência de playback típica com a config atual (segmentos HLS de 2s): 6–12s. Ver [STREAMING_ARCHITECTURE.md](STREAMING_ARCHITECTURE.md) para detalhes e cenários em que isso deve ser reconsiderado.
