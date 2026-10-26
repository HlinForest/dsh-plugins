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
