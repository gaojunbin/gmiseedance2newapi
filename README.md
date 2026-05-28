# gmiseedance2newapi

`gmiseedance2newapi` is a standalone bridge that lets an unchanged new-api deployment keep using the VolcEngine/Doubao Seedance video task interface while the real upstream is GMI Cloud Seedance 2.0.

It does not modify the `new-api` repository.

## What It Exposes

Primary new-api / VolcEngine-compatible routes:

```text
POST /api/v3/contents/generations/tasks
GET  /api/v3/contents/generations/tasks/:id
```

These are the routes called by new-api's `DoubaoVideo` / `VolcEngine` video task adapter when its channel Base URL points at this bridge.

Additional convenience routes:

```text
POST /v1/video/generations
POST /v1/videos
GET  /v1/video/generations/:id
GET  /v1/videos/:id
GET  /v1/videos/:id/content
GET  /v1/models
GET  /healthz
```

Native GMI request-queue paths under `/api/v1/ie/requestqueue/apikey/...` are proxied as well.

## Quick Start

```bash
cd ~/Documents/GitHub/gmiseedance2newapi
docker compose up -d --build
```

Or:

```bash
./start.sh
```

`start.sh` supports both modern `docker compose` and legacy `docker-compose`.
It creates `.env` from `.env.example` if needed.

If new-api will pass the GMI Cloud API key as the channel key, `GMI_API_KEY` can stay empty. The bridge forwards the incoming `Authorization: Bearer ...` header to GMI Cloud.

## new-api Configuration

Create or edit the existing Seedance channel in new-api:

```text
Type: DoubaoVideo or VolcEngine video channel already used for Seedance
Base URL: http://YOUR_BRIDGE_HOST:3001
Key: YOUR_GMI_CLOUD_API_KEY
Models: doubao-seedance-2-0-260128,doubao-seedance-2-0-fast-260128
```

Your business request can remain the same as before. new-api will call:

```text
POST http://YOUR_BRIDGE_HOST:3001/api/v3/contents/generations/tasks
GET  http://YOUR_BRIDGE_HOST:3001/api/v3/contents/generations/tasks/:id
```

The bridge converts those calls to GMI Cloud:

```text
POST https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests
GET  https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests/:request_id
```

## Model Mapping

Default mappings:

```text
doubao-seedance-2-0-260128      -> seedance-2-0-260128
doubao-seedance-2-0-fast-260128 -> seedance-2-0-fast-260128
seedance-2-0-260128             -> seedance-2-0-260128
seedance-2-0-fast-260128        -> seedance-2-0-fast-260128
```

Override or add aliases with `MODEL_MAP_JSON`:

```env
MODEL_MAP_JSON={"my-seedance":"seedance-2-0-260128"}
```

## Parameter Mapping

Volc/new-api fields are mapped into the GMI `payload`:

```text
content[].text / prompt       -> prompt
duration / seconds            -> duration
resolution                    -> resolution
ratio / size                  -> ratio
seed                          -> seed
watermark                     -> watermark
generate_audio                -> generate_audio
tools[type=web_search]        -> web_search
content[].image_url / image   -> first_frame, last_frame, reference_images
content[].image_url role      -> first_frame / last_frame / reference_images
content[].video_url           -> reference_videos
content[].audio_url           -> reference_audios
reference_asset_ids           -> reference_asset_ids
```

Explicit `0` and `false` values are preserved.

If `content[].role` is `first_frame`, `last_frame`, or `reference_image`, that role is respected. This matches the request shape produced by Chatall through new-api for Seedance first-frame and reference-image modes. For legacy role-less requests, the first image becomes `first_frame`; the second image becomes `last_frame`; remaining images become `reference_images`. Set `SECOND_IMAGE_AS_LAST_FRAME=false` if you want every role-less image after the first to become a reference image.

## Billing Compatibility

new-api's current DoubaoVideo task adapter reads `usage.total_tokens` from completed task responses when the model is billed by `ModelRatio` rather than fixed `ModelPrice`.

By default this bridge returns:

```text
usage.total_tokens = generated duration in seconds
usage.completion_tokens = generated duration in seconds
```

That lets you configure the model ratio in new-api as a per-second quota unit without changing new-api code. If you prefer fixed-price billing in new-api, configure `ModelPrice` there; new-api will treat the task as fixed-price and ignore later token recalculation.

Optional environment controls:

```env
BILLING_USAGE_MODE=duration
BILLING_DEFAULT_DURATION=5
BILLING_RESOLUTION_MULTIPLIERS_JSON={"480p":1,"720p":1,"1080p":1}
```

Set `BILLING_USAGE_MODE=zero` to disable usage backfill.

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port used locally and in Docker |
| `GMI_API_BASE_URL` | `https://console.gmicloud.ai` | GMI Cloud API base URL |
| `GMI_API_KEY` | empty | Fallback key when the incoming request has no `Authorization` header |
| `GMI_ORG_ID` | empty | Optional `X-Organization-ID` sent to GMI Cloud |
| `DATA_DIR` | `./data` locally, `/data` in Docker | Persistent task metadata directory |
| `UPSTREAM_TIMEOUT_MS` | `60000` | GMI Cloud request timeout |
| `DEFAULT_MODEL` | `seedance-2-0-260128` | Model used for direct calls without a model |
| `SECOND_IMAGE_AS_LAST_FRAME` | `true` | Map the second image to GMI `last_frame` |
| `MODEL_MAP_JSON` | empty | JSON object for model alias overrides |
| `BILLING_USAGE_MODE` | `duration` | `duration` reports generated seconds as usage tokens; `zero` disables this |
| `BILLING_DEFAULT_DURATION` | `5` | Duration used for billing when upstream omits duration |
| `BILLING_RESOLUTION_MULTIPLIERS_JSON` | empty | Optional JSON object for effective-second multipliers by resolution |

## Health Check

```bash
curl http://localhost:3001/healthz
```

Expected:

```json
{"ok":true,"service":"gmiseedance2newapi"}
```

## Local Verification

```bash
npm test
npm run check
```

The tests use a local mock GMI Cloud server and do not require a real API key.
