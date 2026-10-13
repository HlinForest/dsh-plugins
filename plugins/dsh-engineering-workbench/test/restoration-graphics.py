import sys, unittest
from pathlib import Path
import sexpdata as sx
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'src/restoration'))
from graphics import check_graphics
from curves import source_curve, match_curves

class Graphics(unittest.TestCase):
    def test_mirrored_symbol_is_compared_in_sheet_coordinates(self):
        records=[{'index':1,'fields':{'RECORD':'14','Location.X':'10','Location.Y':'10','Corner.X':'20','Corner.Y':'20'}}]
        components=[{'reference':'U1','owned_record_indices':[1]}]
        tree=sx.loads('(kicad_sch (lib_symbols (symbol "L:U" (symbol "U_0_1" (rectangle (start 2.54 -2.54) (end 5.08 -5.08))))) (symbol (lib_id "L:U") (at 0 0 0) (mirror x) (property "Reference" "U1")))')
        self.assertTrue(check_graphics(records,components,tree,[0,0])['symbolOutlines']['match'])

    def test_native_font_family_and_quarter_turn_are_checked(self):
        records=[{'index':0,'fields':{'RECORD':'31','FontName1':'Times New Roman','Size1':'10','Bold1':'T'}},
                 {'index':1,'fields':{'RECORD':'4','Text':'label','Location.X':'10','Location.Y':'20','Orientation':'1'}}]
        wrong=sx.loads('(kicad_sch (text "label" (at 2.54 -5.08 1) (effects (font (size 1.27 1.27)))))')
        result=check_graphics(records,[],wrong,[0,0]);self.assertFalse(result['nativeTextStyle']['match'])
        right=sx.loads('(kicad_sch (text "label" (at 2.54 -5.08 90) (effects (font (face "Times New Roman") (size 2 2) bold))))')
        self.assertTrue(check_graphics(records,[],right,[0,0])['nativeTextStyle']['match'])

    def test_small_paper_cannot_hide_the_drawing_outside_export(self):
        text='(kicad_sch (paper "User" WIDTH 210) (text "test" (at 100 100 0)))'
        self.assertFalse(check_graphics([],[],sx.loads(text.replace('WIDTH','29.7')),[0,0])['sheetContentBounds']['match'])
        self.assertTrue(check_graphics([],[],sx.loads(text.replace('WIDTH','297')),[0,0])['sheetContentBounds']['match'])

    def test_round_corners_cannot_be_replaced_with_square_corners(self):
        record={'index':1,'fields':{'RECORD':'10','Location.X':'0','Location.Y':'0','Corner.X':'40','Corner.Y':'20','CornerXRadius':'10','CornerYRadius':'10'}}
        identity=lambda x,y:[x,y]
        rectangle=sx.loads('(rectangle (start 0 0) (end 40 20))')
        self.assertFalse(match_curves([record],[rectangle],identity,identity)[1][0]['match'])
        pts=source_curve(record['fields'],identity)
        poly=sx.loads('(polyline (pts '+ ' '.join('(xy %s %s)'%tuple(p) for p in pts)+'))')
        self.assertTrue(match_curves([record],[poly],identity,identity)[1][0]['match'])

    def test_nearly_full_arc_retains_gap_and_fractional_radius(self):
        record={'index':1,'fields':{'RECORD':'12','Radius':'5','Radius_Frac':'26124','StartAngle':'331.586','EndAngle':'329.746'}}
        convert=lambda x,y:[x*.254,-y*.254]
        circle=sx.loads('(circle (center 0 0) (radius 1.33635496))')
        self.assertFalse(match_curves([record],[circle],convert,lambda x,y:[x,y])[1][0]['match'])
        pts=source_curve(record['fields'],convert)
        poly=sx.loads('(polyline (pts '+' '.join('(xy %s %s)'%tuple(p) for p in pts)+'))')
        self.assertTrue(match_curves([record],[poly],convert,lambda x,y:[x,y])[1][0]['match'])

    def test_missing_symbol_body_and_revealed_hidden_field_are_detected(self):
        records=[{'index':1,'fields':{'RECORD':'14','OwnerPartId':'1','Location.X':'10','Location.Y':'10','Corner.X':'20','Corner.Y':'20'}},
                 {'index':2,'fields':{'RECORD':'41','Name':'Comment','Text':'IC','IsHidden':'T','Location.X':'10','Location.Y':'5'}}]
        components=[{'reference':'U1','owned_record_indices':[1,2],'raw_fields':{'CurrentPartId':'1'}}]
        text='(kicad_sch (lib_symbols (symbol "L:U" (symbol "U_0_1" BODY))) (symbol (lib_id "L:U") (at 0 0 0) (unit 1) (property "Reference" "U1" (at 0 0 0)) (property "Value" "IC" (at 0 0 0) (effects (font (size 1 1)) HIDDEN))))'
        bad=check_graphics(records,components,sx.loads(text.replace('BODY','').replace('HIDDEN','')),[0,0])
        self.assertFalse(bad['symbolOutlines']['match']);self.assertFalse(bad['visibleFieldPlacement']['match'])
        good=text.replace('BODY','(rectangle (start 2.54 2.54) (end 5.08 5.08))').replace('HIDDEN','(hide yes)')
        result=check_graphics(records,components,sx.loads(good),[0,0])
        self.assertTrue(result['symbolOutlines']['match']);self.assertTrue(result['visibleFieldPlacement']['match'])

    def test_duplicate_or_moved_text_does_not_pass_content_only_check(self):
        records=[{'index':1,'fields':{'RECORD':'4','Text':'label','Location.X':'10','Location.Y':'20'}}]
        good='(kicad_sch (text "label" (at 2.54 -5.08 0)))'
        self.assertTrue(check_graphics(records,[],sx.loads(good),[0,0])['graphicTextPlacement']['match'])
        for bad in ['(kicad_sch (text "label" (at 4 -5.08 0)))', '(kicad_sch (text "label" (at 2.54 -5.08 0)) (text "label" (at 2.54 -5.08 0)))']:
            self.assertFalse(check_graphics(records,[],sx.loads(bad),[0,0])['graphicTextPlacement']['match'])

if __name__=='__main__':unittest.main()
