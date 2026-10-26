"""Presentation distances in millimetres; independent of reference/net names.
Native geometry is never scaled. All candidates still require native/PDF audit.
"""
PIN_CLEARANCE = 3.81
SERIES_GAP = 7.62
TERMINAL_STUB = 5.08
ARRAY_STUB = 7.62

def label_reserve(text):
    return len(text) * 1.05 + 3 + PIN_CLEARANCE

def layer_spacing(gap):
    return max(SERIES_GAP, gap * 1.5)
