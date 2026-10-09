# Deploy via Docker no NAS

Alternativa ao [VM_DEPLOY_GCP.md](VM_DEPLOY_GCP.md): roda o mesmo servico de ingest num container Docker no seu NAS, usando seu proprio DNS/reverse proxy em vez de uma VM na GCP.

## 1) Preparar `.env`

```bash
cp .env.example .env
```

Edite `.env`:

```dotenv
INGEST_API_PORT=8081
INGEST_API_KEY=troque-por-um-secret-forte

RTMP_INGEST_HOST=192.168.15.9
RTMP_INGEST_PORT=1935
RTMP_APP_NAME=live
RTMP_HTTP_PORT=8000
RTMP_MEDIA_ROOT=./media

# URLs que saem na resposta da API (default de todas: http://${RTMP_INGEST_HOST}:${porta})
PUBLIC_RTMP_BASE_URL=rtmp://app.seu-dominio.example:1935
PUBLIC_PLAYBACK_BASE_URL=https://live.seu-dominio.example
PUBLIC_API_BASE_URL=https://ingest.seu-dominio.example
```

`RTMP_INGEST_HOST` e so o fallback: sem nenhum `PUBLIC_*` setado, as tres URLs saem nele. Cada `PUBLIC_*` governa **uma** URL, e elas quase nunca sao o mesmo nome:

| env | campo na resposta | quem consome |
| --- | --- | --- |
| `PUBLIC_RTMP_BASE_URL` | `rtmpUrl` | campo `Server` do OBS |
| `PUBLIC_PLAYBACK_BASE_URL` | `playbackUrl` | player HLS (o browser) |
| `PUBLIC_API_BASE_URL` | `watchUrl` | player `/watch`, links fora da LAN |

Duas regras que evitam retrabalho:

- **`playbackUrl` tem que sair em `https://`** quando a pagina que toca o HLS e https. Um `http://` aqui vira mixed content e o browser bloqueia o `.m3u8`.
- **`RTMP_INGEST_HOST` pode continuar sendo o IP da LAN** (ou `localhost`) se o OBS publica de dentro da rede — so o playback precisa ser publico.

## 2) Build e subir

```bash
docker compose up -d --build
```

Isso builda a imagem (baixa o binario do MediaMTX correto para amd64/arm64 dentro do Dockerfile) e sobe o container publicando:

- `8081/tcp` API de ingest (`x-api-key`)
- `1935/tcp` RTMP (OBS)
- `8000/tcp` HLS playback

`./media` no host fica montado em `/app/media` no container, entao gravações/segments HLS persistem fora do container.

## 3) DNS e roteamento

- Aponte `ingest.seu-dns-nas.example` para o IP do NAS na sua zona DNS local (ou publica, se for expor externamente).
- RTMP (`1935`) e HLS (`8000`) sao TCP puro: encaminhe as portas diretamente (port forward no router, ou regra no seu reverse proxy em modo TCP passthrough). Nao da pra rodar RTMP atras de reverse proxy HTTP comum.
- A API (`8081`) pode ficar atras do seu reverse proxy HTTP (Nginx Proxy Manager, Traefik, SWAG, etc.) com TLS, do mesmo jeito que a secao 9 do [VM_DEPLOY_GCP.md](VM_DEPLOY_GCP.md) fazia com Nginx + Certbot na VM.

### Cloudflare na frente: o que nao funciona

O proxy da Cloudflare (nuvem laranja) so atende HTTP/HTTPS num conjunto fixo de portas (80, 8080, 8880, 2052, 2082, 2086, 2087, 2095 / 443, 2053, 2083, 2087, 2096, 8443). Consequencia pratica:

- `seudominio.com:8081`, `:8000` e `:1935` **nao passam** pelo proxy — o pedido morre na borda e nem chega no NAS. Sintoma: timeout/connection refused mesmo com o container no ar e a porta publicada.
- RTMP (`1935`) nao passa por proxy HTTP em porta nenhuma. Para publicar de fora, o caminho e DNS em **nuvem cinza** (sem proxy) + port forward no router, ou Cloudflare Spectrum (pago).

### O caminho que funciona: Cloudflare Tunnel

Um tunnel publica cada porta local em 443 com TLS, sem abrir porta no router:

```yaml
# ~/.cloudflared/config.yml (ou o container image cloudflare/cloudflared)
tunnel: <ID>
credentials-file: /etc/cloudflared/<ID>.json
ingress:
  - hostname: ingest.seu-dominio.example
    service: http://192.168.15.9:8081
  - hostname: live.seu-dominio.example
    service: http://192.168.15.9:8000
  - service: http_status:404
```

```bash
cloudflared tunnel route dns <ID> ingest.seu-dominio.example
cloudflared tunnel route dns <ID> live.seu-dominio.example
```

Com os dois hostnames no ar, o `.env` fecha assim:

```dotenv
PUBLIC_API_BASE_URL=https://ingest.seu-dominio.example
PUBLIC_PLAYBACK_BASE_URL=https://live.seu-dominio.example
RTMP_INGEST_HOST=192.168.15.9   # OBS publica na LAN; publicando de fora, veja a secao acima
```

## 4) Configurar backend hosteado

Mesma configuracao da secao 10 do guia de GCP, so trocando o host:

```dotenv
DEFAULT_LIVE_API_BASE_URL=https://ingest.seu-dominio.example
DEFAULT_LIVE_API_KEY=mesmo-valor-do-INGEST_API_KEY-do-NAS
DEFAULT_LIVE_TIMEOUT_MS=10000
```

`VM_INGEST_*` ainda funciona como fallback, mas os nomes atuais sao `DEFAULT_LIVE_*` (ver `apps/world-service/.env.example`). O world-service chama `GET /ingest/current`; a mesma sessao tambem responde em `GET /stream/current`, o nome da fachada que o front consome.

## 5) Operacao

```bash
docker compose logs -f       # logs do servico + MediaMTX
docker compose restart       # reiniciar
docker compose down          # parar (mantem imagem/volume)
docker compose up -d --build # rebuild apos mudar codigo/.env
```

## Checklist de seguranca

- Mesma checklist da secao 12 do [VM_DEPLOY_GCP.md](VM_DEPLOY_GCP.md): proteger `/ingest/*` com `x-api-key`, restringir CORS em producao, nao expor secrets no git, rotacionar `INGEST_API_KEY`.
- No NAS, restrinja o acesso a interface de gerenciamento (SSH/admin) da mesma forma que faria numa VM publica.
