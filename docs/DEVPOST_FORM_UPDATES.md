# Devpost form updates after trust-boundary hardening

Use these replacements if the submitted form can still be edited. The public
video may remain because its visible product flow has not changed; update the
description so the video build and current LIVE build are not presented as the
same artifact.

## Elevator pitch (195 characters including spaces)

Understudy uses WebMCP to help teams surface the tacit judgment missing between formal process steps, then encode it in versioned playbooks that assign work, verify evidence, and route approvals.

## Short description

Understudy observes real work and interviews the expert about the tacit
judgment missing between formal process steps. It turns the reviewed result
into a reusable playbook whose tasks capture required values, check branches,
route recovery, and reach human sign-off. WebMCP lets the visitor's agent and
the page share that process-building surface.

## Technical description / project story

Use [`DEVPOST_STORY.md`](DEVPOST_STORY.md). It now distinguishes the portable
one-script observation/tool tier from the action, persistence and authenticated
server integration needed for governed shared execution.

## Testing instructions

Open the LIVE URL in the Codex desktop app's WebMCP-capable browser. Sign in as
`judge` / `webmcp2026`; this disclosed demo account may switch among Kim, Park
and Lee so judges can show a multi-role handoff on one screen. Ask “What is
this, and how do I use it?”, enter one work activity, answer the on-page
question cards, review the map, save it, and run the saved playbook. Host
mutations require an on-page approval. The tested external client is Codex's
built-in browser; physical phones, other browser engines, production SSO and
tenant isolation are outside the submitted test matrix. All demo data is
fictional. The LIVE origin is enrolled with a WebMCP Origin Trial token, so a
supported Chromium client does not require a manual experimental flag; the
token does not add WebMCP support to an incompatible client.

## Which agents or clients were tested?

Codex desktop's built-in browser was used for the full WebMCP tool discovery
and E2E journey. Browser automation tested the rendered app and a 375px
viewport, but that is not a physical-device or external-client certification.

## Which AI tools were used?

OpenAI ChatGPT/Codex and Anthropic Claude were used for implementation,
adversarial code review, test design and copy review. The product itself does
not send work data to a site-owned LLM backend; a visitor invokes the page's
WebMCP tools through their own compatible agent.

## Level of learning

We learned that agent collaboration needs a clear split between data and
instructions, and between UI guidance and authorization. Early versions relied
too much on browser-computed progress and demo persona strings. We removed the
agent force/auto-approve paths, marked user-authored tool content as untrusted,
bound normal users to their sessions, and added a transaction-time server guard
that rechecks order, role, evidence and approval ownership. We also learned to
state the integration boundary precisely: one script supplies observation and
teaching; governed shared execution requires the host actions, store and server
adapter.

## Video description note

The video demonstrates the submitted interaction: service introduction,
work-entry capture, questions, map correction, typed fields/dropdown branches,
role handoff, evidence refusal and human approval. The LIVE service may contain
later trust-boundary hardening. Record the video's commit separately from the
current LIVE commit in the release evidence; do not describe the video as a
pixel-identical capture of the newest build.
