# Lectern screens to build

Every screen follows `DESIGN.md` (tokens, type, components by section number). All screens are drawn at 1440 x 900 unless noted, light theme unless noted. Content below is exact: use these strings. Code shown in the sample is illustrative mock content; the real app reads the files.

Shared sample notebook (all screens):
- Notebook: **NeoForge 1.21.1 modding**
- Sources and layers:
  - PINNED DOCS: `NeoForge docs` 63 files (water), `Porting primers` 4 files (heath)
  - CODE ROOTS: `neoforge` 956 files, `live · 21.1.77` (spruce); `geckolib` 353 files, `live · 4.7.1` (sand)
  - YOUR REPO: `Well Thats Grading` 212 files, `main · 3 dirty` (moor)
- Rail footer: `Indexed 2 min ago` / `1,588 files · 5 sources` / `MCP · CLI listening on :7419` (dot verified)
- History:
  - `047` Client-to-server packets after SimpleChannel · `today · 3 citations` (moved dot)
  - `046` Mana that survives death: attachments · `yesterday · 7 citations`
  - `045` Block entity renderers with GeckoLib · `Oct 21 · 5 citations`
  - `044` Data components instead of NBT tags · `Oct 20 · 9 citations`
- Top bar: logo mark + `LECTERN` · `NeoForge 1.21.1 modding` (switcher) · `> 047 Client-to-server packets` · mini receipt `2  1  0 · 1 uncited` · palette field `Ask, jump, or run  Ctrl K` · index `1,588 files · 2 min ago` · theme toggle.
- Key strip (page focus): `J next claim  K previous  1-9 citation  O open at line  C copy  / ask  P studio` | right: `verified  moved  unverified  no mark = uncited` with glyphs.

---

## 1. Main: answer with citations, one hover card open

**Purpose.** The screen used hundreds of times a day. It must be calm, show verification at a glance, and show the hover preview of citation 3 (moved) open.

**Layout.** DESIGN 5.2 reference layout: rail 248, page with gutter 40 / column 660 / gap 36 / margin 300, composer pinned, key strip.

**Page content, top to bottom.**
1. Kicker row: `QUESTION 047` (accent) · `asked 14:02 · Opus` (mono-sm ink-3).
2. Headline (DESIGN 4.2 `headline`): `How do I register a client-to-server packet?` upright, then ` I only know SimpleChannel.` in italic 400.
3. Trail (collapsed, DESIGN 11.10): `TRAIL  Read 3 files · 2 searches · checked 3 citations · 4.1 s  L`.
4. Answer prose (`read`), three paragraphs. Claim spans are underlined `[...]`; chip numbers in braces:
   - P1: `SimpleChannel is gone in 1.21.1. ` + [`A packet is now a record that implements CustomPacketPayload`]{1, water, verified} + `, carrying its own Type and a StreamCodec that reads and writes it.`
     (`CustomPacketPayload`, `Type`, `StreamCodec` are inline code.)
   - P2: `You register it on the mod bus. ` + [`RegisterPayloadHandlersEvent hands you a registrar for a version string`]{2, spruce, verified} + `, and playToServer binds the type, the codec and your handler in one call.`
   - P3: [`Handlers run on the main thread by default`]{3, water, moved} + `, so you can touch the level inside the handler without scheduling. Send it from the client with PacketDistributor.sendToServer(new PingPayload(4)).`
     The second sentence of P3 is uncited: no band, no mark.
5. Gutter marks: verified mark beside the first line of claim 1; verified mark beside claim 2's first line; moved mark + `L96` beside claim 3's first line. Nothing beside the uncited sentence.
6. Code block on `--well`, with header line `PingPayload.java` (mono-sm) and a `Copy` quiet button:
   ```java
   public record PingPayload(int value) implements CustomPacketPayload {
       public static final Type<PingPayload> TYPE =
           new Type<>(ResourceLocation.fromNamespaceAndPath("wtg", "ping"));
       public static final StreamCodec<ByteBuf, PingPayload> CODEC =
           ByteBufCodecs.VAR_INT.map(PingPayload::new, PingPayload::value);

       @Override public Type<PingPayload> type() { return TYPE; }
   }

   // in your mod constructor: modBus.addListener(RegisterPayloadHandlersEvent.class, e ->
   e.registrar("1").playToServer(PingPayload.TYPE, PingPayload.CODEC, ServerPing::handle);
   ```
   Caption: `Sketch assembled from citations 1 and 2. Not in your repo yet.`
7. Actions row: `Copy with citations  C` · `Challenge a claim  X` · `Show the code path`.
8. Scrutiny link: `What could make this wrong for 1.21.1?  W`.
9. Composer (DESIGN 11.3) idle-focused: kicker `ASK`, right `Question 048`; placeholder `Ask a follow-up, or press / for a new question`; scope chip `All 5 sources` with five swatches; model `Opus`; primary `Ask  Enter`.

**Margin content.**
1. Full receipt: kicker `CHECKED` + `re-read 14:02`; numerals `2` verified, `1` moved, `0` unverified (ink-4), `1` uncited; caption `Every quote here was found again in its file, or where it moved to. Sentences with no mark are uncited.`
2. Kicker `CITATIONS` + `1-9  [ ]`.
3. Card 1 (aligned to claim 1): chip 1 (water), verified glyph, `VERIFIED`; quote `"Payloads are records implementing CustomPacketPayload."`; `networking/payload.md:9`.
4. Card 2 (aligned to claim 2): chip 2 (spruce), `VERIFIED`; code line on well `public PayloadRegistrar registrar(String version) {`; `RegisterPayloadHandlersEvent.java:31`.
5. Card 3 (aligned to claim 3): chip 3 (water, moved styling), `MOVED`; quote `"By default, handlers are executed on the main thread."`; `networking/payload.md:96`; `Cited L92, found at L96. Same text.`
6. Studio compact panel: kicker `STUDIO`, rows `09  Sequence diagram ...... diagram`, `10  Dependency graph ...... graph`, `17  Porting guide ...... doc`, `23  Build X here ...... doc`; link `All 24 recipes  P`.

**Open hover card** (DESIGN 11.7) anchored under chip 3, pinned state:
- Header: moved glyph + `MOVED` · `3 of 3`.
- Quote: `"By default, handlers are executed on the main thread."`
- Location: water swatch · `networking/payload.md` `:96`.
- Moved line: `Cited L92, found at L96. Same text.`
- Actions: `Open at line  O` · `Copy ref` · `Challenge  X`.
- Claim 3 shows the claim-cursor treatment (band-strong on moved wash, ink caret bar in gutter), card 3 ringed.

**States to show (as variants of this screen).**
- A. Complete (above).
- B. Streaming: headline placed; live trail `TRAIL  grep PayloadRegistrar · neoforge > read RegisterPayloadHandlersEvent.java 22-58 > read networking/payload.md 1-120 > checking 3 citations` (current step ink, earlier ink-3); P1 and P2 revealed, P3 mid-sentence with the trailing 3-word fade; chips 1 and 2 resolved, chip 3 pending (dashed ink-4) at full width; gutter shows two marks and one pending outline; receipt numerals `-` with caption `Checking 3 citations...`; composer shows `Stop  Esc`.
- C. Trail expanded: rows
  - search · `grep "PayloadRegistrar" neoforge` · `4 matches in 3 files` · `0.3 s`
  - read · `RegisterPayloadHandlersEvent.java 22-58` · `37 lines` · `0.1 s`
  - read · `networking/payload.md 1-120` · `120 lines` · `0.1 s`
  - search · `grep "HandlerThread" NeoForge docs` · `2 matches in 1 file` · `0.2 s`
  - check · `3 citations` · `2 verified, 1 moved` · `0.4 s`
  - the drawing sits above the rows: a band per source, a station per file or search in visit order, solid legs for reads and dashed for searches, cited files marked in their status colour
- D. Underline-only mode (`H`): no bands, underlines and marks stay.
- E. One unverified variant: chip 2 unverified, its gutter shows the dashed query ring, card 2 reads `UNVERIFIED` + `Quote not found in RegisterPayloadHandlersEvent.java. Searched 1 file, 0 matches.` + `Search all sources`; receipt `1 1 1 1` with caption `1 quote was not found. It is marked in red.`
- F. Width 1180: margin folded, one-line receipt under the trail, hover card is the only citation surface.
- G. Proof ribbons (`V`): the margin widens into the cited files, each verified or moved card shows its lines, and a ribbon runs from the claim to them. A moved card has a second, dashed ribbon to the line it was cited at. `J`/`K` fills one claim's ribbon and thins the rest.

---

## 2. Studio: all 24 recipes browsable, one generating with live trail

**Layout.** Rail stays. Page area becomes Studio: left the sheet index (6 columns x 5 group rows), right a 360px column with the detail panel (top) and Printed sheets (bottom). Top bar shows the running chip `Tech spec · 4 of 6`.

**Header.** Kicker `STUDIO · SHEET INDEX` (accent) · `Print the notebook as one of 24 sheets. Every sheet keeps its citations.` in `read-sm` ink-2 · right: segmented `Index | List  V` and filter field `Type to filter` (focused state shows caret).

**Index rows** (row label at left in kicker with group hatch swatch; cells per DESIGN 11.19; blurbs exact):
- PLAN (clay): `01 PRD` "Problem, users, goals, checked against the sources" · `02 Tech spec` "How it will be built, from a PRD or an idea" · `03 Build plan` "Phases and tasks with files and checks" · `04 ADR` "One decision, its options and why" · `05 Test plan` "What to test and how to know it passed"
- VISUAL (heath): `06 Code map` "Graph of the codebase's main parts" `needs: root` · `07 Concept map` "How the ideas in the sources connect" · `08 Flow diagram` "Trace how something happens, step by step" · `09 Sequence diagram` "Who calls whom, in order" · `10 Dependency graph` "Imports between packages, cycles marked" `needs: root`
- AGENT (spruce): `11 CLAUDE.md` "Project memory for Claude Code" · `12 AGENTS.md` "Instructions for any coding agent" · `13 Skill` "A SKILL.md with valid frontmatter" · `14 Agent quiz` "Questions an agent must answer from the sources"
- LEARN (water): `15 Onboarding` "First day in this codebase" · `16 Cheat sheet` "One page of the things you look up" · `17 Porting guide` "From one version to another" · `18 Gotchas` "What bites, with the right way cited" · `19 Glossary` "Terms and where they are defined" · `20 Flashcards` "Cards to drill the essentials"
- CODE (sand): `21 Gap report` "Where the code and the docs disagree" `needs: root` · `22 Diff review` "Findings on a diff, ranked" `needs: diff` · `23 Build X here` "How to build something using this codebase's patterns" · `24 Release notes` "From a git log" `needs: git log`

Note: sheet numbers follow the order in `recipes.mjs`, which is the order above (prd, tech-spec, impl-plan, adr, test-plan, code-map, concept-map, flow-diagram, sequence-diagram, dependency-graph, claude-md, agents-md, skill, agent-quiz, onboarding, cheat-sheet, porting-guide, gotchas, glossary, flashcards, gap-report, diff-review, build-x, release-notes). The Main screen's compact panel uses these numbers too. Contour lines run in the 1px gutters and around the frame only.

**Cell states shown at once.**
- `02 Tech spec`: running. Neatline trace at 4/6 of its perimeter, accent dot top right, bottom row `4 of 6 · Sync` + segment bar.
- `09 Sequence diagram`: selected (ink neatline), its form is in the detail panel.
- `06 Code map`: done unseen (ink dot).
- `24 Release notes`: hovered (band-strong ground).
- One cell focused by keyboard is the selected one.

**Detail panel** (selected `09 Sequence diagram`): kicker `SHEET 09 · VISUAL`; title `Sequence diagram`; blurb `Who calls whom, in order. Each step links to the line that does it.`; field `Feature` (required) filled with `Client sends a payload to the server and the server updates the player`; model `Sonnet`; primary `Print sheet  Ctrl+Enter`.

**Live generation block** (above Printed sheets, for the running Tech spec):
- Title `Tech spec · Mana system` (ui-strong), meta `sheet 02 · from PRD sheet 01 · Opus`.
- Segment bar 6 segments, 3 done, 1 current: `4 of 6 · Sync`.
- Section list: `1 Overview` verified glyph `3 citations` · `2 Data model` `5 citations` · `3 Persistence` `4 citations` · `4 Sync` (current, ink) · `5 HUD` (ink-4) · `6 Risks` (ink-4).
- Live trail line: `TRAIL  read docs/datastorage/attachments.md 1-140 > grep AttachmentType neoforge > read AttachmentType.java 30-96 > writing section 4`.
- Quiet buttons `Open draft` · `Cancel`.

**Printed sheets** list (DESIGN 11.21):
- `Networking map` · `sheet 06 · graph · 48 nodes · 31/32 verified · 2h ago` (new dot)
- `Mana system PRD` · `sheet 01 · doc · 6 sections · 22/22 verified · yesterday`
- `Payload flashcards` · `sheet 20 · flashcards · 12 cards · 12/12 verified · yesterday`
- `Mana build plan` · `sheet 03 · plan · 4 phases · 14 tasks · Oct 22`
- `Ping sequence` · `sheet 09 · sequence · 9 steps · Oct 21`

**Key strip:** `type to filter  00 jump  Enter open  V list view  Esc back`.

**States to show.**
- A. Index with running + selected (above).
- B. Filtering: filter `map` typed; only `06 Code map` and `07 Concept map` at full opacity, rest at 0.25.
- C. List view (`V`): contents page with dot leaders, group kickers with swatches, same running state on row 02.
- D. Print finish frame: `02 Tech spec` neatline closed, the new row `Mana system tech spec · sheet 02 · doc · 6 sections · 27/28 verified · now` at the top of Printed sheets, toast `Sheet 02 printed. Tech spec · 6 sections.  Open`.
- E. No printed sheets: empty line and contour sheet drawing.

---

## 3. Code map artifact

**Header** (DESIGN 12 sheet header, visual group heath): kicker `SHEET 06 · VISUAL · CODE MAP`; title `NETWORKING MAP`; meta `neoforge · 14 nodes · Opus · $0.41 · printed 12:08`; receipt mini `13 verified · 1 moved · 0 unverified`; actions `Regenerate` `Export` `Copy` `...`; tabs `Rendered` (active) `Source` `Citations 14`.

**Canvas.** Layered top to bottom, dot grid, legend bottom left (kinds used: event, class, interface, external), zoom controls bottom right `- 100% + Fit 0`, search box top left `Find a node  F`.

Nodes (kind / label / ref):
- L0: external `Mod event bus`
- L1: event `RegisterPayloadHandlersEvent` (ref `RegisterPayloadHandlersEvent.java:31`, verified)
- L2: class `PayloadRegistrar` (ref `PayloadRegistrar.java:58`, verified)
- L3: interface `CustomPacketPayload` (ref `CustomPacketPayload.java:12`, verified) · class `CustomPacketPayload.Type` (ref `CustomPacketPayload.java:20`, verified) · interface `StreamCodec` (ref `StreamCodec.java:18`, verified) · interface `IPayloadHandler` (ref `IPayloadHandler.java:9`, verified)
- L4: class `NetworkRegistry` (ref `NetworkRegistry.java:212`, verified) · interface `IPayloadContext` (ref `IPayloadContext.java:24`, verified) · class `HandlerThread` (ref `HandlerThread.java:6`, moved: cited L4 found L6)
- L5: class `PacketDistributor` (ref `PacketDistributor.java:41`, verified) · class `ClientPacketListener` external
- L6: class `PingPayload` (your repo, moor hatch, ref `src/main/java/dev/kade/wtg/net/PingPayload.java:7`, verified) · class `ServerPing` (your repo, ref `ServerPing.java:12`, verified)

Edges (label): Mod event bus -> RegisterPayloadHandlersEvent `posts` · RegisterPayloadHandlersEvent -> PayloadRegistrar `registrar(version)` · PayloadRegistrar -> CustomPacketPayload.Type `keyed by` · PayloadRegistrar -> StreamCodec `encodes with` · PayloadRegistrar -> IPayloadHandler `routes to` · PayloadRegistrar -> NetworkRegistry `registers in` · IPayloadHandler -> IPayloadContext `receives` · NetworkRegistry -> HandlerThread `dispatches on` · PacketDistributor -> NetworkRegistry `looks up` · PingPayload -> CustomPacketPayload `implements` · ServerPing -> IPayloadHandler `implements` · ClientPacketListener -> PacketDistributor `sends via` (dashed).

**Shown state:** hovering `PayloadRegistrar`: its 5 edges and neighbours at full strength, others 30%. Detail card in the right margin for `PayloadRegistrar`: kind `class`, detail `Builder handed out by RegisterPayloadHandlersEvent. Each play*/configuration* call registers one payload type with its codec and handler. Handlers run on the main thread unless executesOn says otherwise.` with chips 2 and 3, location `PayloadRegistrar.java:58`, `Open at line  O`.

**States to show.** A. Hover + detail (above). B. Search `pay` with 5 matches ringed. C. Matrix view toggle example at a 48-node version (`M`), cycle cells in accent. D. Invalid: banner `This sheet did not validate. 2 errors.` listing `edges[4].to "NetworkRegistery" is not a node id` and `nodes[9].id duplicates nodes[3].id`, raw JSON below, `Retry`.

---

## 4. Build plan artifact

**Header** (plan group clay): kicker `SHEET 03 · PLAN · BUILD PLAN`; title `MANA BUILD PLAN`; meta `Well Thats Grading · from Tech spec sheet 02 · 4 phases · 14 tasks · Opus · $0.62`; receipt mini `18 verified · 0 moved · 0 unverified`; Next step chip `Test plan ->`; segmented `List | Columns` (Columns active at 1440).

**Goal line** (`read`): `Players have a mana pool that persists through death, syncs to the client, and shows on the HUD.`

**Columns** (each with phase header and segment bar):
- PHASE 1 `Data` `2 of 3 tasks`
  - `T1.1` `Mana attachment type` `S` · detail `Register an AttachmentType<Integer> with a codec so mana saves with the player.` · files `src/main/java/dev/kade/wtg/mana/ManaAttachment.java` (new, dashed) · `src/main/java/dev/kade/wtg/WtgMod.java` · acceptance: [x] `Mana saves and loads across a world reload` [x] `Default is 100` · ref chip `attachments.md:41` verified. Done state.
  - `T1.2` `Copy on death` `S` · detail `Set copyOnDeath on the attachment builder.` · acceptance [x] `Mana is the same after respawn` · Done.
  - `T1.3` `Max mana from attribute` `M` · after T1.1 · acceptance [ ] `Max mana reads a custom attribute` [ ] `Attribute shows in /attribute` · Todo.
- PHASE 2 `Sync` `1 of 4 tasks`
  - `T2.1` `ManaPayload record` `S` · files `net/ManaPayload.java` (new) · acceptance [x] `Encodes and decodes with a VAR_INT codec` · Done.
  - `T2.2` `Register playToClient` `S` · after T2.1 · acceptance [x] `Registered on RegisterPayloadHandlersEvent` [ ] `Client handler stores value in ClientManaCache` · In progress (left moved-line bar).
  - `T2.3` `Send on change and on login` `M` · after T2.2 · `Blocked by T2.2` in moved.
  - `T2.4` `Sync test on a dedicated server` `M` · after T2.3.
- PHASE 3 `HUD` `0 of 4 tasks`: `T3.1 Register a GUI layer` `S` · `T3.2 Draw the mana bar` `M` · `T3.3 Hide in spectator` `S` · `T3.4 Config for position` `S`.
- PHASE 4 `Tests` `0 of 3 tasks`: `T4.1 GameTest: copy on death` `M` · `T4.2 GameTest: sync after login` `M` · `T4.3 Manual pass on a server` `S`.

**States to show.** A. Columns (above). B. List view. C. Checking an acceptance item on T2.2 (checkbox stroke drawn, phase bar now `2 of 4`). D. Save failure inline `Could not save. Retry` on that item.

---

## 5. Flashcards artifact

**Header** (learn group water): kicker `SHEET 20 · LEARN · FLASHCARDS`; title `PAYLOAD FLASHCARDS`; meta `NeoForge docs, neoforge · 12 cards · Haiku · $0.03`; receipt mini `12 verified · 0 moved · 0 unverified`; segmented `Cards | Quiz` (Cards active).

**Card** (560 x 340, neatline, faint contour corner):
- Front: kicker `CARD 4 OF 12`; prompt `Where do you get a PayloadRegistrar in 1.21.1?`
- Back: answer `From RegisterPayloadHandlersEvent, on the mod bus. Call event.registrar("1") with your network version.` + chip 1 (spruce, verified) + `RegisterPayloadHandlersEvent.java:31`.

**Piles:** `Again 1` · `Left 8` · `Got it 3`. Buttons `Again  Left` · `Flip  Space` · `Got it  Right` · `Shuffle  S`.

Other cards in the deck (for the deck list in `Source` tab and for the end state): 1 `What replaced SimpleChannel?` / `Payloads: records implementing CustomPacketPayload, registered through PayloadRegistrar.` · 2 `What two things does every payload carry?` / `A Type (its id) and a StreamCodec.` · 3 `Which call registers a client-to-server payload?` / `registrar.playToServer(type, codec, handler).` · 5 `On which thread do handlers run by default?` / `The main thread.` · 6 `How do you send to the server from the client?` / `PacketDistributor.sendToServer(payload).` · 7 `How do you send to one player?` / `PacketDistributor.sendToPlayer(player, payload).` · 8 `What does optional() on the registrar do?` / `Lets the other side connect without this payload registered.` · 9 `How do you make a handler run on the network thread?` / `registrar.executesOn(HandlerThread.NETWORK).` · 10 `What must match on both sides for a connection?` / `The registrar's version string.` · 11 `Where does the handler get the player?` / `From IPayloadContext.player().` · 12 `What is a StreamCodec for a single int?` / `ByteBufCodecs.VAR_INT, mapped to your record.`

**States to show.** A. Front. B. Back (flipped). C. End of deck `12 of 12 done. 9 got it, 3 again.` + `Review the 3 again`. D. Quiz mode on card 5 as a single-choice question with options `The network thread` / `The main thread` / `A worker pool` / `The render thread`, answered correctly with explanation and chip.

---

## 6. Sequence diagram artifact

**Header** (visual group heath): kicker `SHEET 09 · VISUAL · SEQUENCE DIAGRAM`; title `PING, CLIENT TO SERVER`; meta `neoforge, Well Thats Grading · 6 actors · 9 steps · Sonnet · $0.12`; receipt mini `8 verified · 1 moved · 0 unverified`.

**Actors** (sticky header boxes, kind tint): `Player input` (external) · `Client mod code` (moor, your repo) · `PacketDistributor` (class) · `Connection` (external) · `NetworkRegistry` (class) · `ServerPing handler` (moor, your repo).

**Steps:**
1. Player input -> Client mod code: `key press` 
2. Client mod code -> PacketDistributor: `sendToServer(new PingPayload(4))` (ref `KeyHandler.java:33`, verified)
3. PacketDistributor -> NetworkRegistry: `checks the payload is registered for this connection` (ref `PacketDistributor.java:41`, verified)
4. PacketDistributor -> Connection: `encode with PingPayload.CODEC` (ref `PingPayload.java:11`, verified)
5. Connection -> NetworkRegistry: `decode on the server` (async, dashed) (ref `NetworkRegistry.java:388`, verified)
6. NetworkRegistry -> NetworkRegistry: `find handler by Type` (ref `NetworkRegistry.java:402`, verified)
7. NetworkRegistry -> ServerPing handler: `handle(payload, context) on the main thread` (ref `networking/payload.md:96`, moved: cited L92)
8. ServerPing handler -> ServerPing handler: `context.player() reads the sender` (ref `ServerPing.java:14`, verified)
   Note on ServerPing lifeline: `Safe to touch the level here: the handler is already on the main thread.`
9. ServerPing handler -> Client mod code: `optional reply with sendToPlayer` (return, dashed) (ref `ServerPing.java:19`, verified)

Activation bars on NetworkRegistry (steps 5 to 7) and ServerPing handler (7 to 9).

**Shown state:** keyboard cursor on step 7: row highlighted with water band-strong, moved glyph after the label, detail card in the right margin with the hover-card content for `networking/payload.md:96`.

**States to show.** A. Cursor on step 7 (above). B. Generating: actors drawn, steps 1 to 4 placed, segment bar `4 of 9`, trail line `read PacketDistributor.java 30-80 > read NetworkRegistry.java 380-420`. C. Export menu open: `SVG`, `Mermaid`, `Copy Mermaid`.

---

## 7. Source drawer open on a Java file at a cited line

**Base:** Main screen (screen 1) behind; the drawer (640) covers the margin; claim 2 is the cursor claim.

**Drawer header:** spruce swatch · `neoforge` · path `net/neoforged/neoforge/network/event/RegisterPayloadHandlersEvent.java` (middle-truncated, copy button) · tabs `File` (active) `Outline` · icon buttons `Open in editor`, `Close  Esc`.

**Status strip** (verified wash): verified glyph · `Citation 2 · verified · line 31`.

**Body** (code on well, line numbers 1 to 40 visible, line 31 at 35% height):
```java
 1  /*
 2   * Copyright (c) NeoForged and contributors
 3   * SPDX-License-Identifier: LGPL-2.1-only
 4   */
 5
 6  package net.neoforged.neoforge.network.event;
 7
 8  import net.neoforged.bus.api.Event;
 9  import net.neoforged.fml.event.IModBusEvent;
10  import net.neoforged.neoforge.network.registration.PayloadRegistrar;
11  import org.jetbrains.annotations.ApiStatus;
12
13  /**
14   * Fired when the network registry is set up.
15   * <p>
16   * Use this event to register payload types and their handlers.
17   * <p>
18   * This event is fired on the mod-specific event bus.
19   */
20  public class RegisterPayloadHandlersEvent extends Event implements IModBusEvent {
21      @ApiStatus.Internal
22      public RegisterPayloadHandlersEvent() {}
23
24      /**
25       * Creates a new {@link PayloadRegistrar}, a builder for registering
26       * payloads.
27       *
28       * @param version the network version; it must match on both sides
29       * @return a registrar set to the given version
30       */
31      public PayloadRegistrar registrar(String version) {
32          return new PayloadRegistrar(version);
33      }
34  }
```
Line 31 on spruce band-strong with a 2px spruce mid bar left of the line number. Lines 24 to 33 (the trail's read range 22-58 clipped to the file) carry a faint `--paper-3` gutter tint meaning "read by the trail".

**Shown interaction:** lines 31 to 32 selected with the floating mini toolbar `Ask about this  /` · `Copy ref`.

**States to show.** A. Verified (above). B. Moved variant on `networking/payload.md` rendered as prose: the passage at L96 banded with `found here`, L92 outlined dashed with `cited here`, status strip moved wash `Citation 3 · moved · cited L92, found at L96`. C. Missing file: `This file is gone from neoforge. It was cited from an older index.` + `Reindex`. D. Outline tab: tree of `RegisterPayloadHandlersEvent` > `RegisterPayloadHandlersEvent()` `registrar(String)` with line numbers.

---

## 8. Command palette over Main

**Base:** Main screen behind the scrim, palette at 18vh.

**Query:** `pay` (caret after).

**Results:**
- ASK: `Ask "pay" across all sources` · `Enter`
- QUESTIONS: `047  Client-to-server packets after SimpleChannel` · `today` (matched in the answer text `payload`)
- FILES:
  - water swatch · `networking/payload.md` · `NeoForge docs` 
  - spruce · `PayloadRegistrar.java` · `neoforge · network/registration`
  - spruce · `CustomPacketPayload.java` · `neoforge · minecraft/network/protocol/common/custom`
  - spruce · `IPayloadHandler.java` · `neoforge · network/handling`
  - moor · `PingPayload.java` · `Well Thats Grading · net`
- STUDIO: none for `pay` (group hidden)
- COMMANDS:
  - `Copy with citations` · `C`
  - `Payload flashcards (sheet 20)` · `open`

First row selected (paper-3), matched letters in ui-strong. Footer `Up Down to move · Enter to open · Tab to scope · Ctrl+Enter ask in new question`.

**States to show.** A. Query `pay` (above). B. Empty query: QUESTIONS (047, 046, 045), COMMANDS (`New question  N`, `Studio  P`, `Add a source  A`, `Toggle theme  Ctrl+Shift+L`, `Shortcuts  ?`). C. Alias match: query `survey` shows `Ask (survey)` first. D. Recipe page: after choosing `Sequence diagram`, the palette shows the recipe form page (Feature field, model, `Print sheet  Ctrl+Enter`, breadcrumb `Studio > Sequence diagram`, Backspace hint). E. No results: query `zzq`, line `No match. Enter asks "zzq" across all sources.`

---

## 9. Onboarding, first run (empty notebook, add sources)

**No centred hero, no cards.** It is a single survey sheet set on the page with the rail in its empty state.

**Rail (empty):** kicker `SOURCES` `scope 0 of 0`; groups `PINNED DOCS`, `CODE ROOTS`, `YOUR REPO` each with one dashed slot `+ Add`; History `No questions yet.`; footer `Nothing indexed yet` / `MCP · CLI off` (ink-4 dot).

**Page: the sheet** (width 860, neatline, double rule top, contour relief in the right 35% only):
- Kicker `SHEET 000 · SETTING OUT` (accent).
- Title `cover-md`: `A BLANK SHEET.`
- Line (`read`, ink-2): `Every good map starts as one. Add the docs you trust and the code you build against. Lectern answers from them and checks every quote it cites.`
- Step 1 `Name the notebook`: text field with value `NeoForge 1.21.1 modding`.
- Step 2 `Add sources`: one field `Paste a folder, a git URL, or a docs URL` with `Add  Enter`; below it, `Found on this machine` list (rows with a suggested layer swatch and kind): `C:/projects/my-app` `git repo · main` (moor, suggested Your repo, `Add`) · `C:/projects/neoforge-src` `21.1.77` (spruce, Code root, `Add`) · `C:/projects/geckolib` `4.7.1` (sand, Code root, `Add`). Then `Pin docs`: `docs.neoforged.net/docs/1.21.1` (water, `Add`).
- Step 3 `What a mark means` (the one-time mark drawing, right column of the sheet): four rows with large 24px glyphs: verified mark `verified · the quote was found again at that file and line` · moved mark + `L96` `moved · the same text was found at another line, and we say which` · query ring `unverified · the quote was not found. It is marked in red.` · empty box `no mark · the sentence has no citation`.
- Footer of the sheet: primary `Start asking` (disabled until one source is added) and quiet `Connect an agent: lectern mcp` in mono.

**States to show.**
- A. Empty (above, nothing added).
- B. Adding: `C:/projects/my-app` and `C:/projects/neoforge-src` added; rail now shows `Well Thats Grading` (moor) with `indexing 88/212` segment bar and `neoforge` with `indexing 412/956`; sheet rows show `Added` with verified glyph; `Start asking` enabled with note `You can ask while indexing. Answers will say what they missed.`
- C. Ready (first-question state on Main): page kicker `QUESTION 001`, headline in ink-3 italic `Nothing asked yet.`, three suggested questions as link rows: `How do I register a client-to-server packet?` · `How do attachments survive player death?` · `How do I add a GeckoLib armor renderer?`; composer focused.
- D. Error: a pasted path that does not exist, inline under the field `Folder not found: C:/projects/my-ap` in accent with the query glyph.

The mark drawing in step 3 is the only place the marks animate as a sequence (each draws in 180ms, 120ms apart, once; off with reduced motion).

---

## 10. Main in dark mode (night chart)

Same content and states as screen 1 state A, with `data-theme="dark"`, using the dark tokens (DESIGN 3.1 to 3.5):
- Paper #0F161D page, #151C25 rail, top bar, margin; hairlines #363E48.
- Ink #EBE7DF headline and prose (Newsreader at weight 380), ink-2 #D1CDC5 labels, ink-3 #B4B1A9 meta.
- Accent #FF9674 on the logo mark, `QUESTION 047`, `CHECKED`, `CITATIONS`, `STUDIO` kickers, sheet numbers, scrutiny link.
- Claim bands: water band #102E3D, spruce band #06312F, moved claim on #3C2A07 with dashed #CA933E underline; chips on layer fills (#143A4E water, #043E3C spruce) with ink #ABD8F3 / #A4DEDA.
- Gutter marks: verified #7CCD8E, moved #EDBB64 with `L96`.
- Code well #080F15 (darker than paper) with dark syntax colours (keyword #CDAEF2, type #8AC7EA, string #81D2CC, number #F7B385, comments #B4B1A9).
- Receipt numerals in #7CCD8E / #EDBB64 / #86837B / #B4B1A9.
- Hover card on #151C25 with 1px #535C66 border and the dark float shadow, open on chip 3 as in screen 1.
- Primary `Ask` button: ground #EBE7DF, text #0F161D.
- Top-bar contour corner in #3E4955.

**States to show.** A. Complete with hover card (above). B. Streaming (as screen 1 B) in dark, to confirm pending chips and the trailing fade read well on dark. C. High contrast dark (DESIGN 3.7): bands off, 2px underlines, ink-3 raised to #D1CDC5.
