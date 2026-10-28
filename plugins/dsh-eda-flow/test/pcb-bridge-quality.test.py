import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'mcp'))
import pcbnew as p

from pcb_bridge_quality import _tail_tracks


def point(x, y):
    return p.VECTOR2I(p.FromMM(x), p.FromMM(y))


def net(board, name):
    item = p.NETINFO_ITEM(board, name)
    board.Add(item)
    return item


def pad(footprint, number, position, item_net):
    item = p.PAD(footprint)
    item.SetNumber(number)
    item.SetAttribute(p.PAD_ATTRIB_SMD)
    item.SetShape(p.PAD_SHAPE_RECT)
    item.SetSize(point(1, 1))
    item.SetPosition(point(*position))
    layers = p.LSET()
    layers.AddLayer(p.B_Cu)
    item.SetLayerSet(layers)
    item.SetNet(item_net)
    footprint.Add(item)
    return item


def track(board, item_net, start, end):
    item = p.PCB_TRACK(board)
    item.SetLayer(p.B_Cu)
    item.SetWidth(p.FromMM(.3))
    item.SetNet(item_net)
    item.SetStart(point(*start))
    item.SetEnd(point(*end))
    board.Add(item)
    return item


class BridgeTailTests(unittest.TestCase):
    def test_collects_multisegment_fork_until_each_external_pad(self):
        board = p.BOARD()
        board.SetCopperLayerCount(2)
        first = net(board, 'BRIDGE_A')
        second = net(board, 'BRIDGE_B')

        bridge = p.FOOTPRINT(board)
        bridge.SetReference('LINK')
        board.Add(bridge)
        first_pad = pad(bridge, '1', (5, 5), first)
        second_pad = pad(bridge, '2', (5, 10), second)

        ext_a = p.FOOTPRINT(board)
        ext_a.SetReference('A1')
        board.Add(ext_a)
        a1 = pad(ext_a, '1', (9, 5), first)
        ext_a2 = p.FOOTPRINT(board)
        ext_a2.SetReference('A2')
        board.Add(ext_a2)
        a2 = pad(ext_a2, '1', (7, 8), first)

        ext_b = p.FOOTPRINT(board)
        ext_b.SetReference('B1')
        board.Add(ext_b)
        b1 = pad(ext_b, '1', (9, 10), second)

        # A multi-segment tail with a fork: LINK.1 -> junction -> A1/A2.
        tail = [
            track(board, first, (5, 5), (7, 5)),
            track(board, first, (7, 5), (9, 5)),
            track(board, first, (7, 5), (7, 8)),
            track(board, second, (5, 10), (9, 10)),
        ]
        board.BuildConnectivity()
        removable, external, locked = _tail_tracks(board, bridge, [first_pad, second_pad])

        self.assertFalse(locked)
        self.assertEqual({item.m_Uuid.AsString() for item in removable},
                         {item.m_Uuid.AsString() for item in tail})
        self.assertEqual({item.m_Uuid.AsString() for item in external[first_pad.GetNetCode()].values()},
                         {a1.m_Uuid.AsString(), a2.m_Uuid.AsString()})
        self.assertEqual({item.m_Uuid.AsString() for item in external[second_pad.GetNetCode()].values()},
                         {b1.m_Uuid.AsString()})


if __name__ == '__main__':
    unittest.main()
