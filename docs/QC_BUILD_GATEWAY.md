# Venture OS local build handoff

Owned fork: https://github.com/quantAsh/nimbalyst-qc. Keep upstream as a separate remote.

This is an opt-in owner-only desktop handoff. It creates real native session drafts
with the objective ready for review; it never submits an agent prompt automatically.
Desktop providers, credentials, permissions and model selection remain native.
Workspace bindings restrict the gateway to explicitly selected directories.
They are not an agent filesystem or network sandbox and must not be offered to tenants.

## Configuration

Use Node 24 and npm 11. Start development only after the owner approves a desktop
launch. For verification use a disposable repository and isolated user data;
do not point tests at the owner's normal desktop data or working repositories.

Create a local JSON configuration outside version control:

```json
{
  "ownerOnly": true,
  "bindings": [
    {
      "organizationId": "YOUR_PLATFORM_ORGANIZATION_ID",
      "workspaceId": "YOUR_PLATFORM_WORKSPACE_ID",
      "workspacePath": "/absolute/path/to/disposable/repository"
    }
  ]
}
```

Launch Nimbalyst with `NIMBALYST_QC_BUILD_CONFIG` pointing to that file.
For isolated verification also set `NIMBALYST_USER_DATA_DIR` to a disposable
absolute directory. Each binding requires a distinct existing directory.
The gateway is disabled unless the configuration is valid and ownerOnly is true.

In the locally running Venture OS backend set `NIMBALYST_LOCAL_ENDPOINT_FILE`
to `<Nimbalyst userData>/mcp-endpoint.json`. The adapter reads the native port
and per-launch bearer token on every request, checks owner-only permissions and
PID liveness, and contacts 127.0.0.1. Never copy the token into version control.
Do not use these settings in cloud deployment.

The gateway exposes POST /v1/projects, POST /v1/sessions, GET /v1/sessions/{id},
POST /v1/sessions/{id}/open, POST /v1/sessions/{id}/cancel and POST /v1/sessions/{id}/artifacts on the native
HTTP listener. These are REST handlers independent of MCP protocol routing.
Requests require native authentication and reject browser Origin headers.
State is saved atomically in owner-only qc-build-gateway-state.json under userData.

## Review and verification

In Venture OS navigate to Admin → Dev Tools → Build Plane, create a new project
and session, then click Open session in Nimbalyst. The app calls the authenticated
/v1/sessions/{id}/open endpoint to route through the configured desktop instance. The fork supports
nimbalyst://project/{gateway-project-id} and nimbalyst://session/{native-id} only
for gateway records in configured directories. The authenticated app opening
path does not require a global macOS URL handler. Standalone nimbalyst:// links
still require the correct handler; follow the Electron package's URL-handler guide.
The native session contains the objective draft. Review and submit it in Nimbalyst.
Cancellation stops an active request through the desktop's existing cancellation
path, clears queued prompts and archives the gateway session.

Polling reports actual native state: awaiting_approval, running, failed, idle or
cancelled. Idle does not certify completed acceptance checks. Signed callbacks,
native diff/test evidence export and worktree reporting are future work; storing
an artifact summary here does not run tests or generate a diff.

Source checks: Electron TypeScript check and focused test:prepush specs for
QcBuildGateway, QcBuildGatewayHost and deepLinkListeners.trackerDocument.
The app repository now includes playwright.nimbalyst-desktop.config.ts and a
passing isolated live test using its real Python adapter: native draft creation,
objective hydration, authenticated desktop opening, persistence across a desktop restart,
status reads and confirmed cancellation with draft clearing and archiving.
No agent prompt is submitted. The test sets disposable user data and repository,
records screenshots/video and closes its own instances. It does not register the
macOS URL handler or certify cancellation during an active provider turn.
The 14 focused native unit tests also verify userData selection before the
desktop module graph loads, preventing cached settings from using a default path.

Tenant beta additionally requires enforceable agent sandboxing, signed context
resolution and event callbacks, QC collaboration/telemetry defaults, staging HTTPS
gateway identities and end-to-end cross-organization isolation tests.

The app also has a persistent owner-profile launcher (`scripts/start-nimbalyst-owner.mjs`)
and opt-in `playwright.nimbalyst-owner.config.ts` check against the running app.
Quantum ML Research is provisioned and bound to the aicommand repository in that
private profile. Its live test creates a review draft, opens it through the app
and checks a disposable real scoped tool container. This does not certify tenant
agent execution. The desktop owner profile remains separate from the headless tenant worker described below.


## Headless tenant controller

`scripts/run-qc-tenant-worker.mjs` runs the owned tenant controller directly with
Node 24+, independently of Electron. The trusted Venture OS backend launches it
with a minimal environment and one expiring job capability delivered through
stdin. The controller calls only job-scoped backend step/tool routes. It has no
model provider credentials, raw context or tool arguments and never launches a
shell or native desktop session.

Venture OS resolves signed context references and approved policies, owns the
model conversation, and executes tools in a real networkless, nonroot Docker
workspace. Model selection is backend configuration: OpenAI Responses,
Anthropic Messages or a local compatible endpoint share the same worker
protocol. No new SDK is required. Owner approval is required to start a draft;
execution ends in owner review with actual bounded test/diff evidence.

The current toolchain is Python and bounded text files in a fresh ephemeral
workspace. It does not check out a repository, run Electron/Node/browser builds,
publish commits or certify acceptance checks. Native desktop sessions and their
automatic evidence export remain separate. Deployment needs HTTPS broker routing,
shared durable job state/signing keys and the trusted Docker host for each job.

Behavioral checks: `node --test packages/runtime/src/ai/server/tenant/QcTenantWorker.test.mjs`.
The Venture OS app's `playwright.nimbalyst-tenant.config.ts` verifies the actual
controller and Docker tools through the UI, including active-tool cancellation
and cross-workspace denial. Its model is a deterministic test fixture. Live
provider access and staging deployment are separate verification steps.


## Owned desktop identity and turn reviews

The fork builds as **QC Nimbalyst** (`com.quantumcreative.nimbalyst`) and owns
`qc-nimbalyst://`. It accepts previously stored Nimbalyst build links at its
internal routing boundary; it does not register or remove the stock OS scheme.
Explicit `NIMBALYST_USER_DATA_DIR` profiles are preserved. The default profile
is a separate QC Nimbalyst directory. This does not migrate or overwrite stock data.

Upstream update feeds, automatic downloads and install-on-quit are disabled.
Manual check/download/install entry points report the custom-build notice.
Packaging has no publish target; establishing a reviewed QC update channel is future work.

Codex `turn/plan/updated` and `turn/diff/updated` now produce one **Turn review**
card per thread/turn in the canonical transcript. It combines the newest plan and
aggregate diff independently, rejects malformed/stale updates, bounds previews and
rebuilds from the raw log. Plan completion is an agent report, not a verified test
result. No model calls are needed for the deterministic regression/browser fixture.
Steering, history-preserving forks and native review/start remain future work.

The current owner process must restart to load the newly built main/renderer code.
Never restart an active owner instance without explicit permission.


## Optional automatic local evidence notification

Add `"callback": {"url": "http://127.0.0.1:8000/api/build-control/callbacks/nimbalyst", "secret": "YOUR_PRIVATE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS"}` alongside `bindings`.
The secret must match the local platform backend's `NIMBALYST_CALLBACK_SECRET`.
Keep this configuration outside Git and use mode 0600. Only loopback HTTP(S),
the exact callback path, and owner-only regular configuration/outbox files are
accepted. No live profile or server setting is changed automatically.

Completed bound sessions queue metadata-only HMAC-SHA256 notifications in the
private `qc-native-evidence-outbox.json` within user data. Delivery retries and
resumes after restart. The outbox is bounded; preserve it for recovery rather
than deleting failed notices. Session GET responses expose `evidenceExport`
configuration, pending count and delivery errors. Start the configured local
platform backend to recover delivery. It needs matching approved repository and
native workspace bindings; callback setup alone does not authorize a checkout.

The platform confirms native state and collects approved checkout differences
against HEAD. Retries reuse receipts and identical diff artifacts. Cancelled
sessions are acknowledged without collection. Diffs include human edits and do
not identify one turn. Empty changes do not certify tests or shipment. Typed
native test-result export remains pending. Native event observation only queues
completions while the desktop is running; persisted notices survive restart.

## QC privacy defaults

The QC distribution does not initialize upstream PostHog or retention clients,
including for legacy opted-in profiles. Telemetry opt-in is disabled in settings.
Cloud collaboration settings, share authentication and sync URL/proxy entry
paths are disabled; legacy stored sync configuration is preserved and returned
as disabled. The Sync panel explains the unavailable configuration without
loading cloud account state. This is not a claim that every upstream network
path is disabled or that a QC cloud service/storage isolation is certified.
QC collaboration endpoint, authentication and cloud tenant acceptance remain
separate release gates. Desktop provider credentials remain native settings.
