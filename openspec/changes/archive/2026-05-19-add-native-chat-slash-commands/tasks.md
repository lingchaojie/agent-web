## 1. Command Catalog Foundation

- [x] 1.1 Add shared slash command types for command entries, support status, execution behavior, and resume candidates.
- [x] 1.2 Implement a server command catalog service that returns built-in `/resume` metadata and safely discovered local command metadata without exposing command bodies.
- [x] 1.3 Register an authenticated read-only command catalog API route and add server route tests for built-ins, safe discovery fallback, and unavailable discovery.
- [x] 1.4 Add client API helpers to fetch command catalog data.

## 2. Composer Command Parsing and Matching

- [x] 2.1 Add client utilities that detect leading slash command queries while leaving non-leading slash text as normal prompt content.
- [x] 2.2 Add matching and ranking utilities for command name, alias, and description matches with active enabled selection behavior.
- [x] 2.3 Add unit tests for parsing, ranking, empty matches, unsupported entries, and keyboard selection state.

## 3. Slash Command UI

- [x] 3.1 Extract or wrap the chat composer so command overlay state is isolated from streaming render state.
- [x] 3.2 Implement the native-style slash command suggestion overlay with highlighted matches, support status, scope, empty state, pointer selection, and mobile-friendly layout.
- [x] 3.3 Wire keyboard handling for ArrowUp, ArrowDown, Tab, Enter, and Escape only while the overlay is open.
- [x] 3.4 Add responsive CSS for the overlay anchored to the composer without disrupting the existing shell layout.
- [x] 3.5 Add client component tests for opening suggestions, selecting entries, closing the overlay, and preserving normal prompt submission.

## 4. Resume Command Workflow

- [x] 4.1 Pass project-scoped history and resume/open callbacks from App into the chat composer command layer.
- [x] 4.2 Implement `/resume` as an app-owned command that opens project-scoped resume choices and does not send raw `/resume` input to Claude.
- [x] 4.3 Support resume candidates that open existing app sessions or invoke the existing resume workflow for native history sessions.
- [x] 4.4 Add client tests for `/resume` empty state, existing app session selection, and history session resume selection.

## 5. Unsupported and Prompt-Insertable Commands

- [x] 5.1 Implement prompt-insertable discovered commands so selection inserts command text for user review without claiming execution.
- [x] 5.2 Implement unsupported command feedback so known unavailable commands are not sent or executed automatically.
- [x] 5.3 Add tests covering prompt-insertable and unsupported command behavior.

## 6. Verification

- [x] 6.1 Run `npm run typecheck`.
- [x] 6.2 Run `npm test`.
- [x] 6.3 Run `npm run build`.
- [x] 6.4 Start the dev server and browser-test normal prompt submission, slash suggestion selection, `/resume` empty state, and `/resume` session selection on desktop and mobile widths.
- [x] 6.5 Run `openspec validate add-native-chat-slash-commands --strict` or the repository's equivalent OpenSpec validation command.
