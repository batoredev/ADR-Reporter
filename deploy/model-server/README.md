# Model server

One GPU machine runs everything the report assistant uses to read photos and understand answers:

- Ollama with three models: `qwen3-vl:2b-instruct` reads photos, `adr-structurer:v2` (trained for this app) turns
  what was read into report fields, and `qwen3:4b` understands chat answers;
- the pack-date helper (`ml/detector/serve.py`), which finds a pack's batch/date block so it is read close up;
- a gateway (Caddy) that serves HTTPS, requires the access key on every request, and lets through only the reading
  requests. Ollama's admin requests (download, create, delete models) can never be reached from outside.

No outside AI service is involved. Report photos are sent only to this machine.

## 1. What you need

- A Linux machine with an NVIDIA GPU of at least 12 GB (a 16 GB T4 or L4 is comfortable): the three models and the
  helper use about 7 GB together.
- Docker with the NVIDIA Container Toolkit.
- A domain name pointing at the machine (for HTTPS), with ports 80 and 443 open. Nothing else needs to be open.

## 2. Collect the model files (on the laptop, PowerShell)

```powershell
cd C:\Users\sriva\Desktop\ADR-Reporter\deploy\model-server
New-Item -ItemType Directory -Force models\detector | Out-Null
Copy-Item ..\..\ml\runs\structurer\20261127-001542\adr-structurer-v2-q8_0.gguf, ..\..\ml\runs\structurer\20261127-001542\Modelfile models\
Copy-Item ..\..\ml\runs\detector\20261127-125942\model.pt, ..\..\ml\runs\detector\20261127-125942\result.json models\detector\
```

`models/` is gitignored. Copy the repository and this `models` folder to the server (for example `git clone` there,
then `scp -r models <server>:<repo>/deploy/model-server/`).

## 3. Start it (on the server)

```bash
cd deploy/model-server
printf 'MODEL_SERVER_DOMAIN=models.your-domain.org\nMODEL_SERVER_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env
docker compose up -d --build
docker compose exec ollama ollama pull qwen3-vl:2b-instruct
docker compose exec ollama ollama pull qwen3:4b
docker compose exec ollama ollama create adr-structurer:v2 -f /models/Modelfile
```

`.env` here holds the access key; it is gitignored and must stay on the server. To change the key, edit it and run
`docker compose up -d`.

## 4. Check it

```bash
TOKEN=$(grep MODEL_SERVER_TOKEN .env | cut -d= -f2)
curl -s -H "Authorization: Bearer $TOKEN" https://models.your-domain.org/api/tags          # lists the 3 models
curl -s -H "Authorization: Bearer $TOKEN" https://models.your-domain.org/detector/health   # {"ok": true}
curl -s -o /dev/null -w '%{http_code}\n' https://models.your-domain.org/api/tags            # 401 without the key
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" https://models.your-domain.org/api/pull   # 404
```

## 5. Point the app at it

In Supabase (Edge Functions, Secrets), or `.env` for a local run:

```
AI_PROVIDER=auto
OLLAMA_BASE_URL=https://models.your-domain.org
OLLAMA_API_KEY=<the MODEL_SERVER_TOKEN>
OLLAMA_MODEL=qwen3-vl:2b-instruct
OLLAMA_TEXT_MODEL=adr-structurer:v2
OLLAMA_CHAT_MODEL=qwen3:4b
OLLAMA_NUM_CTX=8192
OLLAMA_TIMEOUT_MS=130000
PACK_DETECTOR_URL=https://models.your-domain.org/detector
```

Then redeploy the Edge Function. A pack photo takes about 30 to 90 seconds on a laptop GPU, and less on a server GPU.
