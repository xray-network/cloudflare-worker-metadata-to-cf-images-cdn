<a href="https://discord.gg/WhZmm46APN"><img alt="Discord" src="https://img.shields.io/discord/852538978946383893?style=for-the-badge&logo=discord&label=Discord&labelColor=%231940ED&color=%233FCB9B"></a>

# XRAY | Graph | Images CDN — Cloudflare Worker

> [!WARNING]
> **DEPRECATED:** The tool has been moved to XRAY | Graph | Output, which is an internal proprietary XRAY project that acts as a load balancer and proxy tool for API management and documentation in OpenAPI format

> [!NOTE]
> XRAY | Graph | Images CDN — Proxying CIP25, CIP26 (REGISTRY), or CIP68 images from/to Cloudflare Images CDN

## Getting Started
### Prepare Installation

``` console
git clone \
  --recurse-submodules \
  https://github.com/xray-network/cloudflare-worker-metadata-to-cf-images-cdn.git \
  && cd cloudflare-worker-metadata-to-cf-images-cdn
```

### Edit [wrangler.toml](https://github.com/xray-network/cloudflare-worker-metadata-to-cf-images-cdn/blob/main/wrangler.toml)

```
change KV_CDN_COUNTER id
```

### Run Dev Server

```
yarn start
```

### Deploy to Cloudflare Workers

```
yarn deploy
```
