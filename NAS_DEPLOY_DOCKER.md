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

RTMP_INGEST_HOST=ingest.seu-dns-nas.example
RTMP_INGEST_PORT=1935
RTMP_APP_NAME=live
RTMP_HTTP_PORT=8000
RTMP_MEDIA_ROOT=./media
```

`RTMP_INGEST_HOST` deve ser o nome que seu DNS/router resolve ate o NAS (usado para montar `rtmpUrl` e `playbackUrl` retornados pela API).

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

## 4) Configurar backend hosteado

Mesma configuracao da secao 10 do guia de GCP, so trocando o host:

```dotenv
STREAM_PROVIDER=vm
VM_INGEST_API_BASE_URL=https://ingest.seu-dns-nas.example
VM_INGEST_API_KEY=mesmo-valor-do-INGEST_API_KEY-do-NAS
VM_INGEST_TIMEOUT_MS=10000
```

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
