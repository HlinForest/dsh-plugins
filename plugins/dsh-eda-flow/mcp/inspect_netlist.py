"""Read only: summarize the XML netlist just exported by the actual KiCad CLI."""
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

netlist = ET.parse(sys.argv[1]).getroot()
result = {"nets": [{"name": net.attrib.get("name", ""), "nodes": [dict(node.attrib) for node in net.findall("node")]} for net in netlist.findall("./nets/net")]}
Path(sys.argv[2]).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
