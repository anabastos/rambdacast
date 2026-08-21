# Arquitetura de Streaming — Pipeline Atual (rambdacast)

---

## 1. Pipeline atual — do OBS ao navegador

### Visão geral

```
OBS (encoder)
    │
    │  RTMP/TCP  ← protocolo de ingest
    ▼
VM Google Cloud (e2-small, us-east4)
    │  porta 1935 — RTMP ingest
    │
    ▼
MediaMTX (processo filho do Node.js)
    │  valida stream key via callback HTTP interno
    │  /internal/mediamtx/auth
    │
    ├── segmenta vídeo em arquivos .ts (2s cada)
    └── serve HLS via HTTP
         porta 8000
         /live/{streamKey}/index.m3u8
              │
              │  HTTP pull (polling de segmentos)
              ▼
         Navegador
         (hls.js ou player nativo)
```

### Por que cada peça existe

#### VM no Google Cloud (não no Hostinger)

RTMP é um protocolo de stream contínuo baseado em TCP persistente. O OBS abre uma conexão TCP com o servidor e mantém ela aberta por toda a duração da live — exatamente o mesmo problema do multiplayer descrito em `MULTIPLAYER_ARCHITECTURE.md`. Shared hosting PHP fecha processos após ~30s.

A VM roda um processo Node.js que nunca encerra enquanto a live está ativa.

#### DNS público com registro A (`ingest.seudominio.com → IP estático da VM`)

O OBS precisa de um endereço fixo para apontar. O IP da VM no GCP é dinâmico por padrão — se a instância for recriada, o IP muda. O registro A no DNS garante que o OBS sempre aponte para o mesmo hostname, independente de qual instância está ativa no momento.

Fluxo completo:
1. Cria VM a partir do Instance Template no GCP.
2. Anexa o IP estático reservado (`interplanar-ingest-ip`) na instância.
3. DNS já aponta `ingest.seudominio.com → IP estático` — nada precisa mudar no OBS.

#### MediaMTX como engine de ingest/segmentação

MediaMTX é um servidor de mídia especializado (Go), mais leve e eficiente que alternativas como nginx-rtmp ou Node Media Server para HLS. Ele:

- Aceita RTMP na porta 1935.
- Valida cada publish via callback HTTP para o Node.js interno (`/internal/mediamtx/auth`), que checa se o stream key foi autorizado.
- Segmenta o stream de vídeo em arquivos `.ts` de 2 segundos.
- Serve o playlist HLS (`index.m3u8`) e os segmentos via HTTP na porta 8000.

Configuração gerada em runtime pelo Node.js:

```yaml
rtmp: yes
rtmpAddress: :1935
hls: yes
hlsAddress: :8000
hlsAlwaysRemux: yes
hlsSegmentDuration: 2s    # cada segmento .ts tem 2 segundos de vídeo
hlsSegmentCount: 6        # quantos segmentos ficam disponíveis no servidor
webrtc: no
srt: no
authMethod: http
authHTTPAddress: http://127.0.0.1:8081/internal/mediamtx/auth
```

#### HLS como protocolo de playback

HLS (HTTP Live Streaming) funciona por **polling de segmentos**:

```
Navegador lê index.m3u8 (playlist)
    → encontra lista dos últimos N segmentos disponíveis
    → baixa o segmento mais novo (arquivo .ts)
    → espera ~2s
    → relê index.m3u8 (verificar se há segmento novo)
    → baixa próximo segmento
    → repete indefinidamente
```

Isso é fundamentalmente diferente do polling de API descrito no doc de multiplayer. No HLS o polling é de **arquivos estáticos de vídeo**, não de dados de estado. Cada segmento já contém vídeo completo — o player só precisa baixar e reproduzir na sequência certa.

### Fluxo ponta a ponta numerado

```
1. Frontend chama POST /stream/create (world-service no Firebase/Hostinger)
       ↓
2. world-service chama POST /ingest/create na VM (STREAM_PROVIDER=vm)
       ↓
3. VM gera streamKey = UUID sem hífens (ex: a1b2c3d4...)
   VM registra a key em memória (allowedKeys Set)
   VM retorna: { rtmpUrl, streamKey, playbackUrl }
       ↓
4. Frontend exibe rtmpUrl e streamKey para o streamer configurar no OBS
       ↓
5. OBS conecta via TCP/RTMP em rtmp://ingest.seudominio.com:1935/live
   OBS envia streamKey como parte do path: /live/a1b2c3d4...
       ↓
6. MediaMTX recebe a conexão RTMP e faz callback HTTP para Node.js:
   POST /internal/mediamtx/auth { action: "publish", path: "/live/a1b2c3d4..." }
   Node.js verifica se a key está em allowedKeys → retorna 200
       ↓
7. MediaMTX aceita o stream, começa a segmentar em arquivos .ts de 2s
   Atualiza index.m3u8 a cada novo segmento
       ↓
8. Player no navegador (hls.js) lê playbackUrl = http://ingest.seudominio.com:8000/live/a1b2c3d4.../index.m3u8
   Faz polling do playlist a cada ~2s
   Baixa e reproduz segmentos em sequência
       ↓
9. Para encerrar: POST /stream/end → VM revoga a key → MediaMTX para de aceitar publish
```

### Latência real com a configuração atual

Com `hlsSegmentDuration: 2s` e `hlsSegmentCount: 6`:

- O OBS gera vídeo, MediaMTX acumula 2s → grava segmento → publica no playlist.
- O player precisa de pelo menos **2-3 segmentos** em buffer antes de iniciar reprodução (proteção contra variações de rede).
- Latência total típica: **6 a 12 segundos** (3 segmentos × 2s + propagação + buffer do player).

Isso é adequado para **lives de entretenimento** (show, DJ, palestra). Não é adequado para **interação em tempo real** (perguntas e respostas ao vivo com resposta imediata, jogos).

### Onde isso vive no código

O pipeline inteiro roda a partir de `src/localRtmpServer.ts`, que sobe o MediaMTX com a config HLS, valida stream keys via callback HTTP, e serve `.m3u8`/`.ts` diretamente.

### Quando reconsiderar essa arquitetura

| Situação | Ação recomendada |
|---|---|
| Lives com 200+ espectadores simultâneos | Colocar Cloudflare (free) como CDN proxy na frente da porta 8000 da VM |
| Precisar de interação síncrona (Q&A ao vivo, reações em tempo real) | Habilitar WebRTC/WHIP no MediaMTX (já suportado nativamente) + TURN server |
| Lives diárias com muitos espectadores e sem vontade de gerenciar infra | Avaliar migrar ingest para um provedor gerenciado (ex.: Cloudflare Stream), mantendo RTMP idêntico no OBS |

---

## 2. Próximos passos

- [ ] **Decisão com Jander** — confirmar se a latência atual (6–12s) é aceitável para o caso de uso de shows.
- [ ] Avaliar adicionar Cloudflare Free como proxy reverso para a porta 8000 (reduz egress GCP e adiciona CDN sem custo).
- [ ] Se WebRTC for necessário: habilitar `webrtc: yes` no config do MediaMTX e testar WHIP com OBS 30+.
- [ ] Definir política de backup de lives (atualmente não há gravação automática).
