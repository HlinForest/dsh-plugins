# Open-source layout dependencies

- ELK / elkjs 0.12.0: Eclipse Public License 2.0; supplied through the existing npm dependency.
- OR-Tools 9.11.4210: Apache License 2.0; install in the configured Python environment. Source: https://github.com/google/or-tools/tree/v9.11 .
- libavoid-js 0.5.0-beta.5: LGPL-2.1-or-later. The unmodified, replaceable Node/WASM distribution and full license are in mcp/vendor-libavoid. Source and rebuild instructions: https://github.com/Aksem/libavoid-js . Underlying libavoid source: https://github.com/mjwybrow/adaptagrams .

The host applies circuit constraints before routing. All generated results are checked through the KiCad netlist, ERC and geometry checks.

## Fact-only input path

1. Ordinary PDF text extraction supplies document names, page numbers and text.
2. The model records batches of cited device facts. The host rejects drawing
   dimensions, coordinates and unsupported quotations at this boundary.
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
   form parallel branches above it. Receiver filters and pull-ups use a compact
   local circuit with a straight output trunk. Separate ground islands connect
   by net label without a page-spanning return wire.
6. ELK, CP-SAT and libavoid handle remaining placement and routing. Actual KiCad
   net partitions, names, NC markers, component attributes, ERC and PDF geometry
   are independently read back.

These rules do not use display-board reference designators, device part numbers
or old CAD coordinates. The bundled display-board document is a default input;
historical import modes remain separate.
