"""Run restoration Python tests with the configured KiCad Python interpreter."""
import importlib.util
import sys
import unittest
from pathlib import Path

suite=unittest.TestSuite()
for file in sorted(Path(__file__).parent.glob('restoration-*.py')):
    if file.name==Path(__file__).name:continue
    spec=importlib.util.spec_from_file_location(file.stem.replace('-','_'),file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
if not suite.countTestCases():raise RuntimeError('No restoration tests discovered')
result=unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
