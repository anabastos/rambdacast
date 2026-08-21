# Deploy por Instance Template (Ingest RTMP OBS)

Guia direto ao ponto para usar Instance Template no Google Cloud: voce cria o template uma vez e depois sobe/derruba instancias de ingest sob demanda.

## 1) Criar Instance Template no Compute Engine

Escolha sugerida:
- Tipo: `e2-small`
- SO: `Ubuntu 22.04 LTS`
- IP externo: habilitado

### Comandos gcloud (template)

Preencha as variaveis e execute:

```bash
PROJECT_ID="seu-projeto-gcp"
REGION="us-east4"
ZONE="us-east4-a"
TEMPLATE_NAME="interplanar-ingest-template"
MACHINE_TYPE="e2-small"

# Define projeto padrao
gcloud config set project "$PROJECT_ID"

# Cria instance template com Ubuntu 22.04
gcloud compute instance-templates create "$TEMPLATE_NAME" \
  --machine-type="$MACHINE_TYPE" \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-balanced \
  --tags=ingest-vm
```

## 2) Criar instancia a partir do template

```bash
INSTANCE_NAME="interplanar-ingest-001"

gcloud compute instances create "$INSTANCE_NAME" \
  --source-instance-template="$TEMPLATE_NAME" \
  --zone="$ZONE"
```

## 3) Reservar IP estatico (recomendado)

```bash
STATIC_IP_NAME="interplanar-ingest-ip"

gcloud compute addresses create "$STATIC_IP_NAME" \
  --region="$REGION"

STATIC_IP=$(gcloud compute addresses describe "$STATIC_IP_NAME" \
  --region="$REGION" \
  --format='value(address)')

echo "Static IP: $STATIC_IP"

# Anexa o IP estatico na instancia ativa
INSTANCE_NAME="interplanar-ingest-001"

gcloud compute instances delete-access-config "$INSTANCE_NAME" \
  --zone="$ZONE" \
  --access-config-name="external-nat"

gcloud compute instances add-access-config "$INSTANCE_NAME" \
  --zone="$ZONE" \
  --access-config-name="external-nat" \
  --address="$STATIC_IP"
```

## 4) Abrir firewall (inbound)

Portas necessarias:
- `1935/tcp` RTMP (OBS)
- `8000/tcp` HLS/FLV playback
- `443/tcp` API HTTPS
- `22/tcp` opcional, restrito ao seu IP

```bash
# RTMP
gcloud compute firewall-rules create allow-ingest-rtmp \
  --network=default \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:1935 \
  --target-tags=ingest-vm \
  --source-ranges=0.0.0.0/0

# Playback
gcloud compute firewall-rules create allow-ingest-playback \
  --network=default \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:8000 \
  --target-tags=ingest-vm \
  --source-ranges=0.0.0.0/0

# HTTPS API
gcloud compute firewall-rules create allow-ingest-https \
  --network=default \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:443 \
  --target-tags=ingest-vm \
  --source-ranges=0.0.0.0/0
```

Opcional SSH restrito:

```bash
YOUR_IP="SEU_IP_PUBLICO/32"

gcloud compute firewall-rules create allow-ingest-ssh-restricted \
  --network=default \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:22 \
  --target-tags=ingest-vm \
  --source-ranges="$YOUR_IP"
```

## 5) DNS publico

Crie registro A:
- `ingest.seudominio.com -> STATIC_IP`

## 6) Preparar runtime na instancia

Conecte na VM:

```bash
gcloud compute ssh "$VM_NAME" --zone="$ZONE"
```

Se estiver usando nome da instancia criado no passo 2, use:

```bash
gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE"
```

Instale dependencias:

```bash
sudo apt update
sudo apt install -y curl git nginx tar

# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# MediaMTX
MEDIAMTX_VERSION="1.9.3"
curl -L "https://github.com/bluenviron/mediamtx/releases/download/v${MEDIAMTX_VERSION}/mediamtx_v${MEDIAMTX_VERSION}_linux_amd64.tar.gz" -o /tmp/mediamtx.tar.gz
sudo tar -xzf /tmp/mediamtx.tar.gz -C /usr/local/bin mediamtx
sudo chmod +x /usr/local/bin/mediamtx

node -v
npm -v
mediamtx --version
```

## 7) Subir servico da pasta vm

No seu computador local, envie o projeto para a VM (exemplo com git):

```bash
# Na VM
cd /opt
sudo git clone https://github.com/INTER-PLANAR/world-service.git interplanar-broadcast
sudo chown -R $USER:$USER /opt/interplanar-broadcast
cd /opt/interplanar-broadcast/vm

cp .env.example .env
# edite .env com valores reais
nano .env

npm install
npm run build
```

### .env da VM (ingest) - exemplo

```dotenv
INGEST_API_PORT=8081
INGEST_API_KEY=troque-por-um-secret-forte

RTMP_INGEST_HOST=ingest.seudominio.com
RTMP_INGEST_PORT=1935
RTMP_APP_NAME=live
RTMP_HTTP_PORT=8000
MEDIAMTX_PATH=/usr/local/bin/mediamtx
RTMP_MEDIA_ROOT=./media

# Preset recomendado no encoder do OBS
OBS_AUDIO_CODEC=aac
OBS_AUDIO_BITRATE_KBPS=192
OBS_AUDIO_SAMPLE_RATE_HZ=48000
OBS_AUDIO_CHANNELS=2
```

gcloud compute instances describe interplanar-ingest-001 \
  --zone=us-east4-a \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
  -> IP PUBLICO

## 8) Rodar como daemon (systemd)

Crie arquivo:

```bash
sudo nano /etc/systemd/system/interplanar-ingest.service
```

Conteudo:

```ini
[Unit]
Description=Interplanar VM Ingest Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/interplanar-broadcast/vm
ExecStart=/usr/bin/node /opt/interplanar-broadcast/vm/dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Ative e inicie:

```bash
sudo systemctl daemon-reload
sudo systemctl enable interplanar-ingest
sudo systemctl start interplanar-ingest
sudo systemctl status interplanar-ingest --no-pager
```

## 9) HTTPS na API da VM (Nginx + Let's Encrypt)

Nginx site:

```bash
sudo nano /etc/nginx/sites-available/ingest
```

Conteudo:

```nginx
server {
  listen 80;
  server_name ingest.seudominio.com;

  location / {
    proxy_pass http://127.0.0.1:8081;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Ative o site:

```bash
sudo ln -s /etc/nginx/sites-available/ingest /etc/nginx/sites-enabled/ingest
sudo nginx -t
sudo systemctl reload nginx
```

TLS:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ingest.seudominio.com
```

## 10) Configurar backend hosteado (Firebase)

No servico hosteado, manter:

```dotenv
STREAM_PROVIDER=vm
VM_INGEST_API_BASE_URL=https://ingest.seudominio.com
VM_INGEST_API_KEY=mesmo-valor-do-INGEST_API_KEY-da-VM
VM_INGEST_TIMEOUT_MS=10000
```

Importante:
- O backend hosteado vai consumir a VM somente para stream.
- Realtime/chat/auth continuam no backend hosteado.

## 11) Teste fim a fim

1. Chame no backend hosteado:

```bash
curl -X POST https://SEU_BACKEND_HOSTEADO/stream/create \
  -H "Content-Type: application/json" \
  -d '{"title":"Minha Live"}'
```

2. Pegue `rtmpUrl` e `streamKey` da resposta.

3. No OBS:
- `Server = rtmpUrl`
- `Stream Key = streamKey`

4. Abra `playbackUrl` no player/front.

5. Confira stream atual:

```bash
curl https://SEU_BACKEND_HOSTEADO/stream/current
```

6. Encerre:

```bash
curl -X POST https://SEU_BACKEND_HOSTEADO/stream/end
```

## 12) Checklist de seguranca minimo

- Proteger `/ingest/*` com `x-api-key`.
- Restringir CORS da API da VM (evitar `*` em producao).
- Limitar SSH por IP.
- Nao expor secrets no git.
- Rotacionar `VM_INGEST_API_KEY` periodicamente.

## 13) Criar e matar instancias sob demanda

Use estes comandos quando quiser pagar apenas quando estiver transmitindo.

### Criar nova instancia a partir do template

```bash
PROJECT_ID="seu-projeto-gcp"
ZONE="us-east4-a"
TEMPLATE_NAME="interplanar-ingest-template"
INSTANCE_NAME="interplanar-ingest-$(date +%Y%m%d-%H%M%S)"

gcloud config set project "$PROJECT_ID"

gcloud compute instances create "$INSTANCE_NAME" \
  --source-instance-template="$TEMPLATE_NAME" \
  --zone="$ZONE"
```

### (Opcional) Anexar IP estatico na nova instancia

```bash
REGION="us-east4"
STATIC_IP_NAME="interplanar-ingest-ip"

STATIC_IP=$(gcloud compute addresses describe "$STATIC_IP_NAME" \
  --region="$REGION" \
  --format='value(address)')

gcloud compute instances delete-access-config "$INSTANCE_NAME" \
  --zone="$ZONE" \
  --access-config-name="external-nat"

gcloud compute instances add-access-config "$INSTANCE_NAME" \
  --zone="$ZONE" \
  --access-config-name="external-nat" \
  --address="$STATIC_IP"
```

### Parar temporariamente (mantem disco e IP)

```bash
gcloud compute instances stop "$INSTANCE_NAME" --zone="$ZONE"
```

### Ligar novamente

```bash
gcloud compute instances start "$INSTANCE_NAME" --zone="$ZONE"
```

### Matar/remover a instancia (recomendado para custo minimo)

```bash
gcloud compute instances delete "$INSTANCE_NAME" --zone="$ZONE"
```

### Matar tambem o template (se nao for mais usar)

```bash
gcloud compute instance-templates delete "$TEMPLATE_NAME"
```

### (Opcional) Liberar IP estatico para nao cobrar

```bash
REGION="us-east4"
STATIC_IP_NAME="interplanar-ingest-ip"

gcloud compute addresses delete "$STATIC_IP_NAME" --region="$REGION"
```

### (Opcional) Remover regras de firewall criadas

```bash
gcloud compute firewall-rules delete \
  allow-ingest-rtmp \
  allow-ingest-playback \
  allow-ingest-https \
  allow-ingest-ssh-restricted
```

Observacao:
- `stop` geralmente evita custo de CPU/RAM, mas disco e alguns recursos continuam cobrando.
- `delete` remove a instancia. Se tambem apagar IP estatico/firewall nao usados, corta custos residuais.
- Template quase nao custa, e permite subir uma nova instancia rapidamente.

## Status do servico VM neste projeto

Ja implementado na pasta `vm`:
- Sobe RTMP + playback local (HLS/FLV) com Node Media Server.
- Expoe API protegida por `x-api-key`:
  - `POST /ingest/create`
  - `GET /ingest/current`
  - `POST /ingest/end`
  - `GET /health`
- Gera `rtmpUrl`, `streamKey` e `playbackUrl` reais para OBS/player.
- Aceita ingest somente com stream keys autorizadas por `create`.

Validacao local ja feita:
- `npm install` e `npm run build` em `vm` compilaram sem erro.

Proximo passo para uso:
1. Configurar variaveis em `.env` da VM (copiando de `.env.example`).
2. Subir o servico na VM.
3. No backend hosteado manter:
   - `STREAM_PROVIDER=vm`
   - `VM_INGEST_API_BASE_URL` apontando para a API da VM
   - `VM_INGEST_API_KEY` igual ao `INGEST_API_KEY` da VM
