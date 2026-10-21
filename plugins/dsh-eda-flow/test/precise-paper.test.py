import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import sys
sys.path.insert(0,str(Path(__file__).parents[1] / 'mcp'))

spec = importlib.util.spec_from_file_location('precise_mcp', Path(__file__).parents[1] / 'mcp' / 'precise_mcp.py')
precise = importlib.util.module_from_spec(spec)
spec.loader.exec_module(precise)


class PaperTests(unittest.TestCase):
    def test_a3_persists_and_can_be_read_and_edited(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = precise.Engine(directory, 'kicad-cli')
            engine.call('precise_create', {'request_key': 'create', 'name': 'large', 'paper': 'A3'})
            engine.call('precise_apply', {'request_key': 'edit', 'items': [
                {'id': 'caption', 'kind': 'text', 'text': 'Right of A4', 'at': [350, 100]}
            ]})
            self.assertTrue(engine.call('precise_read', {})['file_matches_model'])
            self.assertEqual(engine.load()['paper'], 'A3')
            self.assertIn('(paper "A3")', (Path(directory) / 'large.kicad_sch').read_text())

    def test_legacy_a4_state_renders_identically(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = precise.Engine(directory, 'kicad-cli')
            engine.call('precise_create', {'request_key': 'create', 'name': 'legacy', 'portrait': True})
            state = engine.load()
            expected = precise.render(state)
            state.pop('paper', None)
            engine.state_path.write_text(json.dumps(state), encoding='utf-8')
            self.assertEqual(precise.render(state), expected)
            self.assertIn('(paper "A4" portrait)', expected)
            self.assertTrue(engine.call('precise_read', {})['file_matches_model'])


if __name__ == '__main__':
    unittest.main()
