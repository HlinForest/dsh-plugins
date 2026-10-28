# Open-source layout dependencies

- ELK / elkjs 0.12.0: Eclipse Public License 2.0; supplied through the existing npm dependency.
- OR-Tools 9.11.4210: Apache License 2.0; install in the configured Python environment. Source: https://github.com/google/or-tools/tree/v9.11 .
- libavoid-js 0.5.0-beta.5: LGPL-2.1-or-later. The unmodified, replaceable Node/WASM distribution and full license are in mcp/vendor-libavoid. Source and rebuild instructions: https://github.com/Aksem/libavoid-js . Underlying libavoid source: https://github.com/mjwybrow/adaptagrams .

The host applies circuit constraints before routing. All generated results are checked through the KiCad netlist, ERC and geometry checks.

## Fact-only input path

1. Ordinary PDF text extraction supplies document names, page numbers and text.
2. The model records batches of cited device facts. The host retains cited
   physical dimensions separately from schematic geometry, and rejects supplied
   drawing coordinates and unsupported quotations.
3. The design model references accepted facts by ID and proposes connections.
   The host expands pin and material records; conflicting overrides are checked,
   not silently corrected.
4. Resistors, capacitors and connectors reuse installed KiCad symbols. Dual-inline
   ICs with consecutive pin numbering use two ordered pin columns. Three-pin
   receivers group supply, output and return on one side. Other devices use
   functional pin grouping on the library grid. Digit/indicator counts
   produce functional display graphics without treating a schematic as a package
   drawing.
5. Functional groups and orientations follow roles and connectivity. Series
   resistor banks face and align with their driving pins on either side; input
   shunts share a short local return rail beside the hub; decoupling capacitors
   search the owner's free sides using measured symbol and field envelopes.
   Placement scores include the outward terminal leads and omit a return path
   only when that return is actually represented by local labels. This allows
   a bypass to slide beside an occupied feed row without a forced U-turn.
   Receiver filters and pull-ups use a compact
   local circuit with a straight output trunk. Separate ground islands connect
   by net label without a page-spanning return wire.
6. ELK, CP-SAT and libavoid handle remaining placement and routing. Page planning
   is a separate module: it receives measured group bounds and weighted shared
   signal nets, excludes shared supply/return hubs, and solves non-overlap and
   proximity before requesting a larger sheet. Group array order is a reading
   preference, not an implicit fixed placement. Explicit row boundaries remain
   constraints. The bounded solver can return a feasible result without proving
   a global optimum.
7. Unrouted terminal leads must stay within their reserved channels. General
   routed graphs include external detours in their measured envelopes. Bend
   alignment to the connection grid is accepted only after checking fixed
   endpoints, symbol obstacles and contacts between different nets; incompatible
   terminal geometry keeps its original coordinates. Actual KiCad
   net partitions, names, NC markers, component attributes, ERC and PDF geometry
   are independently read back, including a separate check for wires outside the
   reserved drawing area. PDF glyph matching recognizes KiCad's active-low
   overbar notation (`~{NAME}` renders the letters `NAME`); native pin names
   retain the notation. Glyph matching does not verify the overbar stroke.

These rules do not use display-board reference designators, device part numbers
or old CAD coordinates. The display-board preset supplies visible editable text;
datasheet PDFs are uploaded separately. Historical import modes remain separate.

The page-planning interface is `pack_groups(...)` in `mcp/page_planning.py`.
Electrical design, local circuit geometry and page placement remain separate:
page placement translates a group as a rigid whole and cannot change its parts,
values, pins, wires or NC state. Tests exercise packing counterexamples, signal
affinities, caption clearance and explicit row constraints. Native regressions
also use unrelated filter and divider circuits. Passing those cases establishes
bounded regression coverage, not universal schematic quality or AD equivalence.

Local motifs stop at shared supply/return domains and at non-chain endpoints,
so a shared ground cannot accidentally absorb a second load into a series
branch. Branch banks are distinguished by the full cardinal direction.
Placement reserves the measured field envelope, terminal lead and router port
of every local component. Tied control pins and upstream feeds are completed
as additional local connections; labels are assigned per physically connected
wire island. A matching net name alone never proves a required local wire.

Constraint-placement inputs are canonicalized before constructing CP-SAT
variables. The shared trunk position is a solver variable rather than the first
member of an unordered pin set. A single worker and deterministic search budget
make the tested layouts stable across process hash seeds and array order. This
is bounded reproducibility evidence, not a guarantee across solver versions.

## Nominal operating points

Stage 3 accepts `design.operatingPoints` for resistor-limited loads, single-R
supply filters and output pull-ups. The host checks actual fitted component
values and electrical domains before deriving currents, voltage drops, RC time
constants and simple rise times. It rejects unrelated or nonparallel parts and
omitted parallel capacitors/pull-ups. Only zero-ohm routing bridges are collapsed
for these calculations; generated nets remain unchanged. These models are
deliberately bounded and reject unsupported arrangements instead of guessing.

Each numeric input carries a current-source quote or an explicit engineering
assumption. Quote checks establish text and unit/quantity correspondence, not
that a model interpreted the operating condition correctly. Assumptions and
missing calculations remain review items. Explicit input-limit violations stop
the candidate before the symbol snapshot. Nominal agreement does not establish
tolerance, thermal, switching, EMC or hardware performance, and no AD component
values are supplied to the designer. Stage 3's parameter review shows the
results and their conditions. Existing frozen designs without operating-point
records are not retroactively marked as calculated.

Library search accepts a full `Library:Name`, a library name or a one-character
symbol name. Exact symbol/identifier matches are ranked before fuzzy matches
and before the 60-result limit. Allowlisted catalogs apply the same ranking only
after limiting the search to authorized entries. This lets ordinary R/C parts
be discovered without injecting a board-specific component table.

## PCB routing and candidate selection

The plugin uses Freerouting 2.1.0 through the local Java wrapper and KiCad's DSN/SES exchange. ELK, OR-Tools and libavoid in the earlier sections primarily address schematic geometry; they do not choose electrically justified component values. PCB routing cannot recover missing current, ripple, timing or load requirements.

The package additionally tries bounded OR-Tools translation compaction after a completed PCB candidate. It uses the generator's actual pads, courtyards, mounting sides, board envelope and visible supply-distance constraints. Mechanical datums remain fixed only when explicitly supplied. Unconnected nets from native DRC can increase their priority in a later compaction attempt. Rotations, component values, footprint pad mapping and net topology are not changed. The proxy objective is only a search aid: a replacement must remain fully connected, preserve native parity and physical pad assignments, and improve measured copper length/short-segment/bend metrics without worsening any of them. A failed solver or candidate leaves the previous completed result selected.

These changes are included in the package; their inclusion does not mean that a newly generated board has passed acceptance. Round 0127 did not establish an acceptable replacement placement. Round 0128 subsequently established a smaller, endpoint-preserving trace improvement on the complete display board: 538.908369 to 537.192922 mm of explicit tracks, 151 to 148 segments, and 101 to 97 degree-two bends; segments below 0.5 mm remained at five. All 29 non-zone signal nets passed an independent native copper traversal; native DRC, parity, and zone-net connectivity also passed. Component positions, values, footprints and all 94 physical pad assignments remained unchanged. This is a local routing-quality improvement, not AD electrical equivalence or production approval.

`python/pcb_trace_simplification.py` uses KiCad's native geometry kernel to propose shorter straight/45-degree chains while retaining endpoints, same-net copper contacts, layer, width and locked objects. It checks actual pads, tracks, copper graphics, board cutouts and track keepouts. After a proposal, the host refills copper and runs native DRC/parity. A proposal is adopted only if connectivity survives and none of track length, short fragments or degree-two bends worsens. A full-board failure-injection test deleted copper and verified restoration of the previous complete PCB. The native routing simplifier has no Shapely dependency. Shapely is used in local diagnostics and is separately required by the optional RapidOCR stack.

Copper fill results are associated by native zone identity, never by iteration position. Generated overlapping domains receive explicit priorities: return domains first, then larger actual pad envelopes before smaller local domains, with a stable net-name tie-break. This is a geometry heuristic rather than an electrical performance decision; native connectivity remains required. The policy and actual priorities are recorded with the copper result. It avoids relying on random zone UUID order and keeps reported fill areas associated with the correct net.

Round 0128's accepted integration case regenerated the complete DSN from the current schematic and proved equality to the previously accepted DSN except its output filename before replaying that SES. It then ran actual KiCad simplification, refill, DRC and exports. Separate new-router and local rip-up trials retained unconnected items and were rejected. No fresh DeepSeek generation was performed in this routing investigation. Round 0127/0128 store native candidates, provenance, independent audits and review records.

Freerouting 2.5.0 was evaluated separately from its official release assets. The Windows native CLI encountered an internal serialization failure. The Java distribution completed routing, but default automatic neckdown violated the visible minimum track width. Disabling neckdown and supplying the minimum neck width removed those width violations; the tested board still had unconnected items. Therefore 2.5.0 has not replaced the bundled router. Trials run locally with analytics disabled; no Freerouting cloud API is used. The portable Java 25 trial runtime remains outside the plugin and does not change system Java.

Sources: [Freerouting 2.5.0 release](https://github.com/freerouting/freerouting/releases/tag/v2.5.0), [CLI settings](https://github.com/freerouting/freerouting/blob/v2.5.0/docs/settings.md). Tool version alone is not evidence of better output; compare identical visible inputs and use native copper connectivity plus engineering review before adoption.


## Round 0129: installed full-board review and figure OCR

A fresh DeepSeek review on the complete 27-component board, followed by actual Freerouting and KiCad execution, changed explicit copper from 492.811568 to 477.585689 mm and degree-two bends from 91 to 71; sub-0.5 mm fragments remained at two. The baseline GRID2 break was removed, but C4 remained isolated on STB. Independent native traversal found 28 of 29 signal nets connected. This candidate was marked needs-revision, not accepted or published to GitHub. These shorter-route metrics must not be reported as an accepted delivery improvement. Nine resistor-value and two capacitor-bank differences against AD remain.

Routing feedback now binds copper-net identity from the actual native zone result before prioritizing failed signal nets. Logical names such as GND are not compared directly to native hierarchical names, and hierarchy is not stripped. This correction changes search behavior but did not by itself complete the tested board.

Optional local RapidOCR 1.4.4 / ONNX Runtime 1.20.1 extracts text from sizeable raster figures even on pages containing searchable text. It recovered three application-diagram constraints missed by ordinary extraction in a real external candidate datasheet and passed the actual upload/display flow. Observations retain page, region, per-line confidence and source hash, remain outside citable source facts, and require applicability and diagram review. The current display-board input was not replaced because the candidate source does not establish the -X suffix. See [figure OCR setup and scope](pdf-figure-ocr.md). OCR model/dependency files are not bundled in the plugin TGZ.

## Coupled PCB branch repair (0.16.3-beta.6)

Freerouting 2.1.0 still performs actual copper routing. When native DRC reports an open branch, the bounded placement search can additionally use OR-Tools to jointly translate the related filter, decoupling and storage parts. Unlike ordinary compaction, these parts may change their separation side relative to neighboring envelopes. The constraints retain physical sides, through-hole obstacles, board margins, declared power distances and user mechanical datums; rotations and electrical topology stay unchanged. Priority net names retain their complete native hierarchy.

This does not add component coordinates to model input, change the schematic or copy a reference board. A shorter placement proxy is only a proposed candidate: fresh routing, copper fill, native DRC, source pad mapping and actual copper quality still decide acceptance. Repair is bounded to two extra candidates, and any previously passing board is retained if a later proposal disconnects or worsens it.

An isolated replay of the complete 27-part display-board request passed native DRC with 515.370577 mm of explicit copper, 140 segments, 4 segments below 0.5 mm and 92 degree-two bends. This is a diagnostic replay, not a fresh model run or AD equivalence claim; the round-0130 Demo records the subsequent installed-plugin run separately.

The subsequent installed-plugin round-0130 used six real DeepSeek calls in PCB generation and evaluated six fresh routed candidates. Candidate 5 passed: 29/29 independent signal-net checks; native DRC errors, warnings, unconnected items and parity errors all zero. Explicit copper is 501.440924 mm, with 139 segments, 4 sub-0.5 mm fragments and 90 degree-two bends. The previous fully connected reference was 537.192922 mm / 148 segments / 5 fragments / 97 bends. Component, footprint, physical pad geometry and net assignments are preserved.

The selected result was the feedback-directed greedy candidate, not either of the two coupled-critical candidates (both still had opens). The later coupled-compaction candidate was connected but lengthened copper and was rejected. These facts limit attribution: the new joint method expands the search and its diagnostic replay passed, but the final metric gain is not evidence that joint placement alone caused the gain. The ordinary native trace shortcut in the selected board saved 1.142284 mm and one bend.

Freerouting 2.1.0 calls an unseeded random shuffle in its single-thread pass ([upstream source](https://github.com/freerouting/freerouting/blob/v2.1.0/src/main/java/app/freerouting/autoroute/BatchAutorouter.java#L275-L276)). Identical placement and DSN geometry produced different routing outcomes in comparison runs. One thread does not establish reproducibility, and an unsupported seed flag must not be advertised as a fix. The full bounded workflow passed this round; a guaranteed first-candidate route or deterministic repeatability is not claimed. Nine resistor values and two capacitor-bank differences against AD remain unresolved; the user explicitly left the IRM-3638M3-X suffix applicability unconfirmed.

## Native power-path placement (0.16.3-beta.7)

Single-layer placement scores a bounded set of legal owner-relative poses with native obstacle-aware supply and return routing. These corridors constrain later placements and stay protected during Freerouting. No historical board coordinates, component IDs or reference values are used. Input distance limits remain unchanged. In beta.7, pad-only compaction was skipped while reserved copper existed. Only internally generated corridor locks are released for whole-copper-coverage cleanup; native DRC and full-board acceptance remain mandatory. This is a geometric routing improvement, not an electrical transient simulation or proof of generalization across board families.

## Copper-aware joint placement (0.16.3-beta.9)

Joint placement now preserves the generator’s current owner, decoupling and storage poses and their actual pre-routed copper while optimizing other components. This preservation is internal to the current candidate, not a user datum or reference-board coordinate. Foreign pads must clear static native copper on the same layer; a conservative bounding-box solver check is followed by a native polygon check. Failed-net endpoints may change their separation direction in the bounded repair candidate. Values, pin/pad mapping, topology, sides and rotations remain unchanged.

Full-board round-0134 replay removed the prior CLK open but retained one ground-network disconnection. Replaying fixed DSN wires plus routed SES proved the ground branch was already open before fill and copper cleanup. Native DRC and an independent copper-union audit located it at the receiver filter returns. Experiments that also locked filter-local paths worsened full-board routing and were rejected; they are not included in this package. This establishes a search capability and a diagnosed remaining failure, not an accepted new board. The Demo and each current review record separately state fresh-model acceptance and unresolved value differences.

## Native local repair (0.16.3-beta.10)

The selected incomplete single-layer candidate can now undergo bounded native bridge relocation and interface-filter return-island repair. The search uses current copper, declared component roles and exact footprints. It preserves electrical identity, fixed datums, assembly sides and protected supply geometry. Only full native DRC/parity plus filled-copper connectivity can authorize adoption. Same-net tree routing compares actual legal path costs; shortcut proposals are individually refilled and rolled back if copper connectivity is lost. See [workflow and limits](native-local-repair.md). Native tool replays and new model runs remain separately recorded in the Demo; this does not resolve missing resistor/capacitor operating conditions.

## Multiple repair seeds (0.16.3-beta.11)

Incomplete-layout quality is not a proof of repairability. The native repair now tries up to three completed, geometrically valid seeds, with per-seed and overall time bounds. A full connected candidate takes precedence over an incomplete route with fewer fragments. The actual seed, DRC and quality results are recorded in local-repair-search.json; fixed-coordinate and source-connectivity restrictions are unchanged.

## Shared repair time (0.16.3-beta.12)

Unused time from quickly rejected seeds stays available to later seeds. The six-minute overall limit remains; each native worker is bounded to five minutes and the allocator reserves a minimum launch window for remaining seeds. This fixes an observed full-board case where a feasible branch required about 173 seconds for complete return repair and cleanup, but the prior 120-second per-seed cap stopped it. That tool continuation is recorded separately from the next installed-model run.

## Branch-preserving collinear cleanup (0.16.3-beta.16)

A collinear trunk can be merged through a branch endpoint without moving either the trunk or branch copper. The prior degree-two-only rule retained tiny fragments at T junctions. Full-board continuation removed four segmentation joints and reduced short fragments from five to three while preserving length, bend count and native DRC/parity; normal installed-flow verification is recorded separately.
