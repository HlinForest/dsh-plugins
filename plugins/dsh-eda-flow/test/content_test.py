import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from content import content_hash

class DesignComparison(unittest.TestCase):
    def test_ids_and_container_order(self):
        a = b'(kicad_pcb (uuid "11111111-1111-1111-1111-111111111111") (net 1 "GND") (segment (start 1 2) (end 3 4) (net 1)))'
        b = b'(kicad_pcb (segment (net 1) (start 1 2) (end 3 4)) (uuid "22222222-2222-2222-2222-222222222222") (net 1 "GND"))'
        # Segment child order is retained; only unordered object containers are sorted.
        b = b.replace(b'(net 1) (start 1 2) (end 3 4)', b'(start 1 2) (end 3 4) (net 1)')
        self.assertEqual(content_hash('x.kicad_pcb', a), content_hash('x.kicad_pcb', b))
        for old, new in [(b'(net 1 "GND")', b'(net 1 "VCC")'), (b'(start 1 2)', b'(start 1 3)'), (b'(net 1)))', b'(net 2)))')]:
            self.assertNotEqual(content_hash('x.kicad_pcb', a), content_hash('x.kicad_pcb', a.replace(old, new)))

    def test_csv_order_and_multiplicity(self):
        a = b'name,value\na,1\nb,2\n'
        self.assertEqual(content_hash('x.csv', a), content_hash('x.csv', b'name,value\nb,2\na,1\n'))
        self.assertNotEqual(content_hash('x.csv', a), content_hash('x.csv', a + b'a,1\n'))

    def test_polygon_order_is_geometry(self):
        a = b'(kicad_pcb (zone (polygon (pts (xy 0 0) (xy 1 0) (xy 1 1) (xy 0 1))))))'
        b = a.replace(b'(xy 1 0) (xy 1 1)', b'(xy 1 1) (xy 1 0)')
        self.assertNotEqual(content_hash('x.kicad_pcb', a[:-1]), content_hash('x.kicad_pcb', b[:-1]))

    def test_uuid_reference_target_changes_are_design_changes(self):
        a = b'(kicad_pcb (segment (uuid "11111111-1111-1111-1111-111111111111") (start 1 2)) (segment (uuid "22222222-2222-2222-2222-222222222222") (start 3 4)) (group "critical" (members "11111111-1111-1111-1111-111111111111")))'
        b = a.replace(b'(members "11111111-1111-1111-1111-111111111111")', b'(members "22222222-2222-2222-2222-222222222222")')
        self.assertNotEqual(content_hash('x.kicad_pcb', a), content_hash('x.kicad_pcb', b))
        c = a.replace(b'11111111-1111-1111-1111-111111111111', b'33333333-3333-3333-3333-333333333333')
        self.assertEqual(content_hash('x.kicad_pcb', a), content_hash('x.kicad_pcb', c))

if __name__ == '__main__': unittest.main()
