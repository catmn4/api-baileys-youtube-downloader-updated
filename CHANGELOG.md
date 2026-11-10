# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.31.7] - 2026-11-04

### Fixed

- use one detection mode for OTP filtering

## [1.31.6] - 2026-11-04

### Added

- add smart OTP detection with sensitivity

## [1.31.5] - 2026-11-04

### Added

- informative room header with phone/LID context

## [1.31.4] - 2026-11-04

### Fixed

- retry unresolved LID reconciliation and dedupe runs

## [1.31.3] - 2026-11-04

### Fixed

- reconcile legacy LID rooms with Baileys mapping

## [1.31.2] - 2026-11-04

### Fixed

- prefer saved contact name from either PN or LID record

## [1.31.1] - 2026-11-04

### Added

- prefer contact name, then phone, then LID for rooms

## [1.31.0] - 2026-11-04

### Added

- persist selected session and merge LID/PN rooms

## [1.30.0] - 2026-11-04

### Added

- merge group inventory into Chat Rooms and streamline actions

## [1.29.0] - 2026-11-04

### Added

- WhatsApp-first message rendering with Markdown enrichment

## [1.28.0] - 2026-11-04

### Added

- optional OTP/verification auto-reply filter

## [1.27.4] - 2026-11-04

### Added

- valid JSON header snippet and key prefixes

## [1.27.3] - 2026-11-04

### Fixed

- use the configured default when the message is blank

## [1.27.2] - 2026-11-04

### Fixed

- persist vision config and polish AI card labels/order

## [1.27.1] - 2026-11-04

### Changed

- label the permission matrix column Capability

## [1.27.0] - 2026-11-04

### Added

- assistant settings, limited group/messaging access and matrix polish

## [1.26.1] - 2026-11-04

### Fixed

- make uptime available to every dashboard role

## [1.26.0] - 2026-11-04

### Added

- media descriptors, safe link previews and opt-in image vision

## [1.25.3] - 2026-11-04

### Changed

- make session assignment rows readable

## [1.25.2] - 2026-11-04

### Changed

- compact module-level permission matrix

## [1.25.1] - 2026-11-04

### Fixed

- enforce API-key session scope and admin-only global actions

## [1.25.0] - 2026-11-04

### Added

- scope manager access and add password visibility toggles

## [1.24.3] - 2026-11-04

### Fixed

- keep the dashboard session across page refreshes

## [1.24.2] - 2026-11-04

### Changed

- describe subpath as an example, not a fixed mount
- document subpath hosting limitation
- Revert "docs(deploy): document that subpath hosting is unsupported"
- Revert "docs(deploy): make bare-IP TLS options explicit"
- make bare-IP TLS options explicit
- document that subpath hosting is unsupported

### Fixed

- sort messages by normalized Baileys timestamps

## [1.24.1] - 2026-11-04

### Fixed

- make the send-tool hint follow the selected scope

## [1.24.0] - 2026-11-04

### Fixed

- make send tool addressable beyond the current chat; neutralize get_info

## [1.23.0] - 2026-11-04

### Added

- built-in send tool and authoritative runtime clock

### Changed

- unescape integration snippet code fences
- drop stale 1.6 section and duplicated content
- correct replay and credential-leak guidance

## [1.22.0] - 2026-11-02

### Added

- safe rotation with grace window, no receiver downtime

## [1.21.0] - 2026-11-02

### Added

- encrypt secrets at rest and add manual rotation

## [1.20.2] - 2026-11-02

### Fixed

- DNS-aware SSRF guard, no redirects, masked secrets, delivery id

## [1.20.1] - 2026-11-02

### Fixed

- orphan janitor, sanitized 5xx, security tests, lighter snapshots

## [1.20.0] - 2026-11-02

### Security

- close traversal/SSRF gaps and remove O(N) work from auth

## [1.19.16] - 2026-11-02

### Changed

- give the webhook session picker a stable width

## [1.19.15] - 2026-11-02

### Changed

- tidy webhook header, keep the create row on one line, neutral label hint

## [1.19.14] - 2026-11-02

### Added

- tidy the REST API header/actions and filter webhook logs by session

## [1.19.13] - 2026-11-02

### Added

- configure one session at a time

## [1.19.12] - 2026-11-02

### Changed

- centre the login title and tagline inside the brand block

## [1.19.11] - 2026-11-02

### Changed

- centre the sidebar group and compact the login header

## [1.19.10] - 2026-11-02

### Changed

- keep the sidebar icon snug against the centred text

## [1.19.9] - 2026-11-02

### Changed

- centre the sidebar text while keeping the icon on the left

## [1.19.8] - 2026-11-02

### Changed

- keep the sidebar icon on the left, vertically centred

## [1.19.7] - 2026-11-02

### Changed

- centre the sidebar brand and keep tagline and version on one line

## [1.19.6] - 2026-11-02

### Changed

- consistent branding with tagline and live version

## [1.19.5] - 2026-11-02

### Changed

- use the project name in the sidebar brand

## [1.19.4] - 2026-11-02

### Added

- per-chat action menu instead of global buttons

## [1.19.3] - 2026-11-02

### Changed

- eliminate horizontal scroll inside modal fields and textareas

## [1.19.2] - 2026-11-02

### Changed

- taller system instruction and tidy example scrollbars

## [1.19.1] - 2026-11-02

### Changed

- remove inline examples and use generic English samples

## [1.19.0] - 2026-11-02

### Added

- modal confirmations and group clear/exit actions

## [1.18.0] - 2026-11-02

### Added

- per-chat clear and delete, both synced with WhatsApp

## [1.17.0] - 2026-11-02

### Added

- clear all is local-only to avoid WhatsApp spam

## [1.16.1] - 2026-11-02

### Fixed

- clear every chat in paced batches

## [1.16.0] - 2026-11-02

### Added

- two-way clear that keeps WhatsApp and the dashboard in sync

## [1.15.0] - 2026-11-02

### Added

- let managers choose all sessions or an assigned subset

## [1.14.0] - 2026-11-02

### Added

- scope assistants to assigned sessions only

## [1.13.3] - 2026-11-01

### Fixed

- type the OpenAPI metadata as unknown

## [1.13.2] - 2026-11-01

### Fixed

- persist read state and hide the self LID chat

## [1.13.1] - 2026-11-01

### Fixed

- show chats addressed with @lid and create rooms for every upsert

## [1.13.0] - 2026-11-01

### Fixed

- keep session config across restarts and clean up on delete

## [1.12.0] - 2026-11-01

### Added

- full tool definition export from the integration snippet

## [1.11.0] - 2026-11-01

### Added

- copy-paste integration snippet for third-party tools

## [1.10.0] - 2026-11-01

### Added

- CDN-friendly policy by default and CDN-hosted assets

## [1.9.0] - 2026-11-01

### Added

- versioned path, public schema, per-session keys and file-backed storage

## [1.8.1] - 2026-11-01

### Added

- structured, actionable errors on the send endpoint

## [1.8.0] - 2026-11-01

### Added

- scoped hashed API keys and an inbound audit log

## [1.7.0] - 2026-11-01

### Added

- unified send endpoint for third-party integrations

## [1.6.2] - 2026-11-01

### Changed

- track CHANGELOG.md
- adopt tags, changelog and a release helper

### Fixed

- show one eye icon in the settings password fields
- only skip version-shaped release commits

## [1.6.1] - 2026-11-01

### Added

- Bounded AI prompt history: message count, age window (default 6 hours) and
  character budget, configurable through `AI_HISTORY_MAX_MESSAGES`,
  `AI_HISTORY_MAX_AGE_MS` and `AI_HISTORY_MAX_CHARS`.

### Fixed

- The vendored DOMPurify build was ignored by `.gitignore` (`vendor/`), so a
  fresh clone — and therefore a Docker deployment — shipped no sanitizer and
  every dashboard page rendered as text. The asset now lives in
  `src/dashboard-ui/js/lib/purify.min.js` and is tracked.

## [1.6.0] - 2026-11-01

### Added

- AI auto-response per number: responder chain (AI → static → webhook),
  time-window routing, OpenAI-compatible driver, tool-calling RAG, debounce,
  human takeover/handoff, prompt-injection guard and routing metrics, plus the
  **AI & Routing** dashboard page.
- Admin user management: create users, approvals, roles, session ownership
  (`ownerId`), per-role quotas (`MAX_SESSIONS_PER_USER`,
  `MAX_SESSIONS_PER_MANAGER`) and delete-with-revoke of sessions/credentials.
- CSP violation reporting (`POST /dashboard/csp-report`) and the
  `CSP_REPORT_ONLY` switch.
- Explicit auth-state backend (`AUTH_STATE_BACKEND`) with a persisted choice and
  a confirmed switch flow.

### Changed

- Dashboard sessions use an HttpOnly cookie instead of a token in
  `localStorage`; SSE authenticates through the same cookie.
- Dashboard markup is rendered through a DOMPurify-sanitized helper; no inline
  styles or handlers remain and `style-src` stays at `'self'`.
- Navigation is gated by real capabilities (session/webhook/role) instead of
  always-visible entries.

### Fixed

- WebKit attaches an inline style to native `<select>`; CSP no longer blocks it
  (`style-src-attr`), removing the Safari console flood.
- CSP reports were rejected with 403 because browsers send an opaque origin.
- The users table rendered empty because `<tr>` fragments were parsed outside a
  table context.
- Malformed `localStorage` no longer throws during navigation.
- Redis is configured with `noeviction`, and an auth-backend mismatch fails fast
  instead of silently starting with an empty session store.

## [1.5.0] - 2026-09-04

### Added

- Gzip compression for large webhook payloads (`WEBHOOK_GZIP_THRESHOLD`).
- Per-receiver-URL circuit breaker so a dead endpoint is paused instead of
  retried forever.
- Standardized error codes and `requestId` tracing in API responses.

### Changed

- A single header/signature builder is shared by test and live webhook sends.

## [1.4.0] - 2026-09-04

### Added

- Webhook dead-letter buffer with replay and an optional SSRF guard.
- Per-receiver-URL outbound rate limit (token bucket).
- Smart retry by HTTP status with `Retry-After` support.
- Humanized WhatsApp interaction engine and human-like broadcast pacing.

### Fixed

- Webhook delivery now times out after 30 seconds instead of locking the queue.
- Unbounded presence map replaced with an LRU cache; synchronous filesystem
  calls removed from hot paths.
