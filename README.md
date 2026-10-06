# <img src="resources/icon.svg" alt="" width="40" align="top">&ensp;Karttapallo

Globe view of an Apple Photos library — fix missing locations and wrong dates or timezones in place.

Photos and videos can be browsed in a built-in full-screen lightbox.

![Karttapallo](screenshot.png)

## Setup

Requires macOS, [Bun](https://bun.sh/), [Homebrew](https://brew.sh/), the Xcode Command Line Tools (`xcode-select --install`), and an Apple Photos library.

```bash
bun install
bun dev       # serve the app in a browser
```

To build and install to `/Applications`:

```bash
brew install zstd openssl   # one-time
bun cert --create           # one-time: create a self-signed code-signing cert
bun install:app             # build, sign, and copy to /Applications
```

### Optional API keys

Add either to `.env` to unlock extra features. Both are optional.

```
PUBLIC_MML_API_KEY=your-key   # MML — Maasto/Orto basemaps
PUBLIC_ORS_API_KEY=your-key   # OpenRouteService — Drive/Hike routing
```

Get keys from [MML](https://www.maanmittauslaitos.fi/rajapinnat/api-avaimen-ohje) and [OpenRouteService](https://openrouteservice.org/).

## Docs

- [CONTEXT](CONTEXT.md) — terms and relationships
- [App](docs/app.md) — code shape and seams
- [Flows](docs/flows.md) — interaction inventory
- [Gotchas](docs/gotchas.md) — non-obvious behaviors
- [Testing](docs/testing.md) — five-tier strategy
- [ADR](docs/adr/) — architectural decisions
- [Diary](docs/diary.md) — chronological log
