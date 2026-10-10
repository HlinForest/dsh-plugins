{ AD 25/26 acceptance pending. This script exports live native objects.
  It does not claim that compilation, ERC or DRC ran merely because export succeeded. }

Function JsonText(S : String) : String;
Begin
    S := StringReplace(S, '\', '\\', [rfReplaceAll]);
    S := StringReplace(S, '"', '\"', [rfReplaceAll]);
    S := StringReplace(S, #13, '\r', [rfReplaceAll]);
    S := StringReplace(S, #10, '\n', [rfReplaceAll]);
    Result := '"' + S + '"';
End;

Procedure ExportCurrentSchematic;
Var
    Document : ISch_Document;
    Iterator : ISch_Iterator;
    Component : ISch_Component;
    Output : TStringList;
    Destination : String;
    Separator : String;
Begin
    Document := SchServer.GetCurrentSchDocument;
    If Document = Nil Then
    Begin
        ShowMessage('Open and save a schematic document first.');
        Exit;
    End;
    Destination := Document.DocumentName + '.dsh-native-objects.json';
    Output := TStringList.Create;
    Iterator := Document.SchIterator_Create;
    Try
        Iterator.AddFilter_ObjectSet(MkSet(eSchComponent));
        Output.Add('{"schema":"dsh.altium.native-objects.v1",');
        Output.Add('"document":' + JsonText(Document.DocumentName) + ',');
        Output.Add('"producer":"Altium Designer scripting",');
        Output.Add('"nativeValidation":"not_performed",');
        Output.Add('"coverage":"current-sheet-components",');
        Output.Add('"components":[');
        Separator := '';
        Component := Iterator.FirstSchObject;
        While Component <> Nil Do
        Begin
            Output.Add(Separator + '{"nativeId":' + JsonText(Component.UniqueId) +
                ',"ref":' + JsonText(Component.Designator.Text) +
                ',"value":' + JsonText(Component.Comment.Text) +
                ',"xMils":' + JsonText(FloatToStr(CoordToMils(Component.Location.X))) +
                ',"yMils":' + JsonText(FloatToStr(CoordToMils(Component.Location.Y))) + '}');
            Separator := ',';
            Component := Iterator.NextSchObject;
        End;
        Output.Add(']}');
        Output.SaveToFile(Destination);
        ShowMessage('Native object inventory exported: ' + Destination + #13#10 +
          'This is not an ERC/DRC result. Run native validation on the saved candidate separately.');
    Finally
        Document.SchIterator_Destroy(Iterator);
        Output.Free;
    End;
End;
