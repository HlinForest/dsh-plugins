# Precise KiCad MCP

Generic exact-coordinate schematic primitives. This service has no circuit-specific templates, imports, requirement parser, inference model, or prebuilt call sequence. The model supplies every symbol, connection, and coordinate as tool arguments. A normal MCP client may launch `precise_mcp.py --root <new-project-root>` over stdio. All CAD source writes happen inside MCP `tools/call` handlers. The separate `inspect_netlist.py` only reads the newly exported KiCad XML netlist for the plugin's presentation tables.

## Invocation

Python 3.10+ with the dependencies in `mcp/requirements.txt` (including OR-Tools for generic schematic constraint layout) and KiCad CLI are required. Configure `mcpPython` (or use `kicadPython` as its fallback) and `kicadCli` in the plugin. The plugin does not require the development computer's directory names. The two Codex demonstrations used KiCad 10.0.6; an intranet installation must verify its own CLI version.

The installed entry point is `src/index.js`. It registers four `eda_precise_*` tools through the existing Harness tool service. `src/precise-tools.js` binds each active stage to a fresh private execution token and a fixed output directory, then launches the packaged `mcp/precise_mcp.py` over stdio. It performs `initialize`, waits for its reply, sends `notifications/initialized`, then `tools/call`. No separate Python client is needed or shipped.

The model sees only the four generic schemas below; the host supplies the token and root. Host `ctx.tools.execute` handles execution and returns the real result. Keys are namespaced by the active stage token to prevent an idempotent cached result in a copied stage project from pointing to an earlier stage. Tool logs retain the model's requested arguments; `mcp-audit.jsonl` retains the actual namespaced arguments. The root restriction is application-level confinement, not an operating-system sandbox.

## Tools and schemas

Full machine schema: `tools/list`, or packaged `mcp/schema.json`. All objects reject unknown fields. Coordinates and font sizes are mm. The page coordinate origin is top-left with Y down; symbol local coordinates use Y up. Rotations use KiCad degrees. No coordinate snapping occurs; serialization retains 9 decimal places.

KiCad itself stores schematic coordinates in 0.0001 mm internal units ([official unit constants](https://docs.kicad.org/doxygen/base__units_8h_source.html)). Placement and local pin offsets round independently. `precise_read.pins[].at` reports the requested mathematical position; `native_at` reports the expected native KiCad position. A wire computed from unrounded sums can miss a pin by 0.0001 mm; use the real netlist plus `native_at` to make an explicit correction call. The service never silently alters the coordinates. This is within a 0.001 mm geometry tolerance. The installed KiCad 10.0.6 ERC JSON has been observed to report positions with an incorrect 1/100 scale; use symbol/wire input and native_at for precise geometry, not ERC JSON pos fields. PDF/SVG geometry and net membership are checked independently.

* `precise_create`: `{request_key, name, title?, paper?: "A4", portrait?: false}`. Refuses preexisting CAD. Root is fixed in the server command line, never in tool arguments.
* `precise_apply`: `{request_key, symbols?: [...], items?: [...], delete_ids?: [...], delete_symbols?: [...]}`. Complete-object upsert by symbol name/item ID. New symbols and placements can share a batch. The entire model is checked before writes; invalid references/geometry leave the original unchanged. Files use individual atomic replacements; readback detects interruptions across the multi-file save.
* `precise_read`: `{include_objects?: true, include_source?: false}`. Returns object model, actual file SHA256, and transformed pin coordinates. Refuses a schematic externally modified since MCP authorship.
* `precise_check_export`: `{request_key, formats: ["pdf","svg","netlist","erc","bom"]}`. Always uses real KiCad XML netlist export for parse validation. ERC reports every finding; never changes pin types or suppresses violations. BOM records all components plus InBOM/OnBoard/DNP columns so excluded and DNP parts remain auditable.

Every mutating/export request needs a unique `request_key`. Retrying the same key and arguments returns the original result without duplicate objects. Reusing a key with different arguments fails. Use a new key for each intentional revision.

### Symbols

`{name, reference_prefix?, description?, datasheet?, footprint?, pin_names_visible?, pin_numbers_visible?, pin_name_offset?, power?, pins: [...], graphics?: [...]}`

Symbol `name` is a library identifier restricted to letters, digits, `_+.-`; the model can choose `S001` etc. Component `reference`, property values, free text and pin names support UTF-8 and spaces. Decoration components without pins and with both in_bom/on_board false may share their original reference such as `*`.

Pin: `{number: "1", name: "VCC", at: [x,y,angle], length, type, shape?: "line", visible?: true, name_visible?: true, number_visible?: true, name_font?, number_font?}`. Pin type is explicit: input/output/bidirectional/tri_state/passive/free/unspecified/power_in/power_out/open_collector/open_emitter/no_connect. Hidden pins remain electrically connected; an NC is a distinct page item.

Harness migration additions: KiCad 10 does not honor per-pin name/number `effects.hide` reliably. Uniform visibility must use symbol-level `pin_names_visible` / `pin_numbers_visible`. The packaged service rejects explicitly contradictory per-pin flags and mixed per-pin visibility as a capability gap; it does not silently rewrite supplied parameters. BOM export also includes all custom properties, PinCount and ObjectRole (component / schematic-decoration / erc-helper), preserving footprint identifiers and distinguishing nonphysical records. These are the documented changes from the generic service used for the two Codex demonstrations.

Graphics: rectangle `{kind,start:[x,y],end:[x,y]}`; rounded_rectangle adds `rx,ry`; polyline adds `points`; arc uses `start,mid,end`; circle uses `center,radius`; text uses `text,at,font`. Geometric graphics accept width, fill (none/outline/background), stroke_type. Rounded rectangle radii clamp to half width/height; elliptical corners become polylines with <=0.00025 mm chord error, preserving exact extrema.

Font: `{size:[height,width], face?:"SimSun", bold?, italic?, thickness?, justify?:["left","top"]}`. No justification means center. Right/bottom and mirror also supported. Appearance varies with installed fonts; font selection remains explicit input.

### Page items

Each item requires a stable caller-chosen `id` and `kind`.

* component: `symbol,reference,at,value?,footprint?,datasheet?,mirror?:"x"|"y",in_bom?,on_board?,dnp?,exclude_from_sim?,properties?`. Properties are `[{name,value,at,visible?,font?}]` and use absolute page coordinates. Reference property must match component reference. Required Reference/Value/Footprint/Datasheet fields get defaults only when absent. Custom names like OriginalFootprint are supported.
* wire: `points:[[x,y],...]`, optional width. All vertices retained; emitted as consecutive KiCad two-point wire segments. No routing or connection inference.
* junction: `at:[x,y],diameter?`.
* no_connect: `at:[x,y]`.
* label: `text,at,font?,visible?,label_type?:local|global|hierarchical,shape?`. Local is default. Orientation is at[2].
* text/rectangle/rounded_rectangle/polyline/arc/circle: same geometry fields as symbol graphics, using page coordinates.

## Files and evidence

The service emits a schematic, minimal editable KiCad project, project symbol library/table, `.precise-state.json`, and `mcp-audit.jsonl`. The audit contains every call's full arguments/result, UTC time, hashes, and previous-entry hash. It detects accidental alterations; it is not a signed independent security log. A project lock prevents concurrent mutation. External file changes are refused. Paths are resolved under the fixed project root; no import API exists. This is application-level confinement, not an operating-system sandbox.

Scope limits: a single A4 sheet, single-unit symbols; no image embeds, PCB generation, hierarchical sheets, or import. Native rounded-rectangle parameters are retained in the authored model while KiCad receives a precision-bounded polyline. All exports use the installed KiCad executable; user-selected footprint/library availability can generate ERC warnings and is never automatically changed.

## Validation

Development source checkout: run `node --test test/text-mcp.test.js` from the plugin root. Set `EDA_TEST_PYTHON`, `EDA_TEST_KICAD`, and optionally `EDA_TEST_ROOT` to available local paths. The test is a clearly labeled model double with `realModelCalls=0`, coupled to actual stdio MCP and KiCad CLI. It covers tool error feedback, questions, inline text, scope restrictions, visibility validation, net membership, PDF/SVG/ERC/BOM exports, copied-project key isolation, and immutable upstream artifacts. The source tests are not part of the installed plugin payload. Harness's actual paid model is deliberately not exercised by these tests; it remains a separate acceptance item.

Format and protocol references: [KiCad schematic format](https://dev-docs.kicad.org/en/file-formats/sexpr-schematic/) and [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports).
