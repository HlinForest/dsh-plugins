import importlib.util
import struct
import sys
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('native_intake', Path(__file__).parents[1] / 'src/restoration/native.py')
native = importlib.util.module_from_spec(spec); spec.loader.exec_module(native)


class NativeIntake(unittest.TestCase):
    def test_truncated_framing_rejected(self):
        with self.assertRaises(ValueError):
            native.parameters(struct.pack('<I', 200) + b'|RECORD=1|')

    def test_raw_encoding_and_duplicates_remain_visible(self):
        data = '|RECORD=4|Text=first|Text=second|%UTF8%Text=中文|'.encode()
        rows = native.parameters(struct.pack('<I', len(data)) + data)
        self.assertEqual(rows[0]['duplicate_fields'], [['Text', 'first', 'second']])
        self.assertEqual(native.text(rows[0]['fields']), '中文')

    def test_unsupported_connectivity_never_becomes_empty_success(self):
        for kind in ['15', '18', '26', '209']:
            with self.assertRaises(ValueError):
                native.connectivity([{'fields': {'RECORD': kind}}], [])

    def test_crossing_without_node_is_not_connected(self):
        records = [{'fields': dict(RECORD='27', LocationCount='2', X1='-10', Y1='0', X2='10', Y2='0')},
                   {'fields': dict(RECORD='27', LocationCount='2', X1='0', Y1='-10', X2='0', Y2='10')}]
        pins = [dict(reference=ref, pin='1', source_locator={}, fields={'Location.X': str(x), 'Location.Y': str(y), 'PinLength': '0'}) for ref, x, y in [('R1', -10, 0), ('R2', 10, 0), ('R3', 0, -10), ('R4', 0, 10)]]
        self.assertEqual(len(native.connectivity(records, pins)['nets']), 2)
        records.append({'fields': {'RECORD': '29', 'Location.X': '0', 'Location.Y': '0'}})
        self.assertEqual(len(native.connectivity(records, pins)['nets']), 1)

    def test_hidden_pin_blocks_unsupported_semantics(self):
        pin = dict(reference='U1', pin='1', source_locator={}, fields={'PinConglomerate': '4'})
        with self.assertRaisesRegex(ValueError, 'Hidden pin'):
            native.connectivity([], [pin])


if __name__ == '__main__':
    unittest.main()
