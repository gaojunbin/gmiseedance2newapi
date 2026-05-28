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
Models: gmi-seedance-2-0-260128,gmi-seedance-2-0-fast-260128
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
MODEL_MAP_JSON={"gmi-seedance-2-0-260128":"seedance-2-0-260128","gmi-seedance-2-0-fast-260128":"seedance-2-0-fast-260128"}
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

This bridge converts GMI Cloud's per-second video prices into synthetic token usage. With new-api's input price set to `$1/M tokens`, configure:

```env
BILLING_USAGE_MODE=duration
BILLING_DEFAULT_DURATION=5
BILLING_RESOLUTION_MULTIPLIERS_JSON={"480p":24000,"720p":52000,"1080p":116000}
```

The mapping is:

```text
480p:  24,000 tokens/second  -> $0.024/second at $1/M tokens
720p:  52,000 tokens/second  -> $0.052/second at $1/M tokens
1080p: 116,000 tokens/second -> $0.116/second at $1/M tokens
```

On the new-api side, do not configure these models with `ModelPrice`; configure token pricing instead. In the combined pricing UI, set input price to `1` for each bridge-facing model. If editing raw `ModelRatio`, use `0.5`, because new-api stores `ModelRatio = input price / 2`.

Do not add these models to `TASK_PRICE_PATCH`. `ModelPrice` and `TASK_PRICE_PATCH` both make new-api treat the task as fixed-price billing and skip the completion-time recalculation from `usage.total_tokens`.

Avoid using `doubao-seedance-2-0-*` as the model name exposed to new-api for this bridge. new-api's Doubao task adapter applies a built-in `video_input` multiplier to those model names when the request contains `video_url`, which can undercharge GMI Cloud video-reference requests. Use aliases such as `gmi-seedance-2-0-260128` and map them to the real GMI model IDs with `MODEL_MAP_JSON`, or use plain `seedance-2-0-*` names if your new-api model configuration allows them.

Environment controls:

```env
BILLING_USAGE_MODE=duration
BILLING_DEFAULT_DURATION=5
BILLING_RESOLUTION_MULTIPLIERS_JSON={"480p":24000,"720p":52000,"1080p":116000}
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
