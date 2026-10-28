import copy
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path[:0] = [str(Path(__file__).resolve().parents[1] / 'python'), str(Path(__file__).resolve().parents[1] / 'mcp')]

import pcb_flow
from record_io import read_json, write_json


class FakeFootprint:
    def GetReference(self):
        return 'U1'

    def GetPosition(self):
        return type('Position', (), {'x': 1000, 'y': 1000})()

    def GetOrientationDegrees(self):
        return 0

    def GetLayer(self):
        return pcb_flow.pcb.B_Cu

    def Pads(self):
        return []


class FakeBoard:
    def GetFootprints(self):
        return [FakeFootprint()]

    def GetTracks(self):
        return []


class Tests(unittest.TestCase):
    def test_failed_repair_restores_record_store_and_exports(self):
        with tempfile.TemporaryDirectory() as temporary:
            out = Path(temporary) / 'a' / 'b' / 'c' / 'out'
            project = out / 'project'
            candidate = Path(temporary) / 'candidate'
            project.mkdir(parents=True)
            candidate.mkdir(parents=True)
            board_name = 'Circuit.kicad_pcb'
            schematic_name = 'Circuit.kicad_sch'
            boardfile = project / board_name
            boardfile.write_bytes(b'original board')
            (project / schematic_name).write_text('schematic', encoding='utf8')
            (candidate / board_name).write_bytes(b'repaired board')
            (candidate / 'drc.rpt').write_text('candidate report', encoding='utf8')
            for name in ['PCB.svg', 'PCB.pdf', 'PCB-Front.svg', 'PCB-Front.pdf', 'PCB-Back.svg', 'PCB-Back.pdf']:
                (candidate / name).write_bytes(('candidate ' + name).encode('utf8'))

            # Seed both authoritative SQLite rows and their exported files.
            for name, value in {
                'placement-result.json': {'state': 'before'},
                'copper-result.json': {'state': 'before'},
                'process-result.json': {'state': 'before', 'inputs': {}},
                'trace-simplification.json': {'state': 'before'},
            }.items():
                write_json(out / name, value)
            for name, value in {
                'drc.json': {'state': 'before'},
            }.items():
                write_json(project / name, value)
            (project / 'drc.rpt').write_text('old report', encoding='utf8')
            for name in ['PCB.svg', 'PCB.pdf', 'PCB-Front.svg', 'PCB-Front.pdf', 'PCB-Back.svg', 'PCB-Back.pdf', 'PCB-pad-map.csv']:
                (project / name).write_bytes(('old ' + name).encode('utf8'))
            original = copy.deepcopy({'drc': {'passed': True}, 'routingQuality': {'trackLengthMm': 99}})
            request = {
                'output': str(out),
                'schematic': schematic_name,
                'cli': 'kicad-cli',
                'plan': {'activeLayers': ['B.Cu'], 'placements': {}},
                'nc': [],
            }
            work = out / 'postroute-repair'
            work.mkdir()
            write_json(work / 'result.json', {
                'adopted': True,
                'candidate': str(candidate),
                'simplification': {},
            })

            def fake_run(args, cwd, timeout=180):
                if '-o' in [str(x) for x in args]:
                    report = Path(args[[str(x) for x in args].index('-o') + 1])
                    report.parent.mkdir(parents=True, exist_ok=True)
                    report.write_text(
                        '** Found 0 DRC violations **\n'
                        '** Found 0 unconnected pads **\n'
                        '** Found 0 Footprint errors **\n',
                        encoding='utf8',
                    )
                return type('Completed', (), {'stdout': '', 'stderr': ''})()

            with patch.object(pcb_flow, 'run', side_effect=fake_run), \
                 patch.object(pcb_flow.pcb, 'LoadBoard', return_value=FakeBoard()), \
                 patch.object(pcb_flow, 'netlist', return_value=([{'ref': 'U1'}], [])), \
                 patch.object(pcb_flow, 'verify_pad_assignments', return_value=True), \
                 patch.object(pcb_flow, 'placement_report', return_value={'passed': True}), \
                 patch.object(pcb_flow, 'export_views'), \
                 patch.object(pcb_flow, 'refresh_copper_report'), \
                 patch.object(pcb_flow, 'route_metrics', side_effect=RuntimeError('injected route metrics failure')), \
                 patch('pcb_local_repair.copper_networks', return_value={'allPhysicalPadNetworksConnected': True}):
                result = pcb_flow.repair_selected(request, original)

            self.assertFalse(result['localRepair']['adopted'])
            self.assertIn('injected route metrics failure', result['localRepair']['error'])
            self.assertEqual(boardfile.read_bytes(), b'original board')
            self.assertEqual((project / 'drc.rpt').read_text(encoding='utf8'), 'old report')
            self.assertEqual(read_json(out / 'placement-result.json'), {'state': 'before'})
            self.assertEqual(read_json(out / 'copper-result.json'), {'state': 'before'})
            self.assertEqual(read_json(out / 'process-result.json'), {'state': 'before', 'inputs': {}})
            self.assertEqual(read_json(out / 'trace-simplification.json'), {'state': 'before'})
            self.assertEqual(read_json(project / 'drc.json'), {'state': 'before'})

            # This row did not exist before the attempted repair.  It must not
            # survive in SQLite after the failed commit, even though the
            # failed candidate briefly wrote it.
            physical = out / 'physical-copper-connectivity.json'
            self.assertFalse(physical.exists())
            db = sqlite3.connect(out / '.eda-records.sqlite')
            try:
                row = db.execute('SELECT 1 FROM records WHERE name=?', (physical.name,)).fetchone()
            finally:
                db.close()
            self.assertIsNone(row)


if __name__ == '__main__':
    unittest.main()
