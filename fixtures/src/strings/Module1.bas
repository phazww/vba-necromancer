Option Explicit

Sub StringChecks()
    Dim ws As Worksheet, r As Long, parts() As String, s As String
    Set ws = Worksheets("Строки")
    r = 1
    s = "  Акт № 10/2 от 31.10.2026  "
    ws.Cells(r, 1).Value = "Trim": ws.Cells(r, 2).Value = Trim(s): r = r + 1
    ws.Cells(r, 1).Value = "Len": ws.Cells(r, 2).Value = Len(Trim(s)): r = r + 1
    ws.Cells(r, 1).Value = "Left5": ws.Cells(r, 2).Value = Left(Trim(s), 5): r = r + 1
    ws.Cells(r, 1).Value = "Mid": ws.Cells(r, 2).Value = Mid(Trim(s), 7, 4): r = r + 1
    ws.Cells(r, 1).Value = "InStr": ws.Cells(r, 2).Value = InStr(1, s, "от"): r = r + 1
    ws.Cells(r, 1).Value = "Replace": ws.Cells(r, 2).Value = Replace("1 234,56", " ", ""): r = r + 1
    ws.Cells(r, 1).Value = "UCase": ws.Cells(r, 2).Value = UCase("заменить подшипник"): r = r + 1
    parts = Split("ТО;ТР;СВ", ";")
    ws.Cells(r, 1).Value = "UBound": ws.Cells(r, 2).Value = UBound(parts): r = r + 1
    ws.Cells(r, 1).Value = "Join": ws.Cells(r, 2).Value = Join(parts, " + "): r = r + 1
    ws.Cells(r, 1).Value = "Like": ws.Cells(r, 2).Value = ("ТР-01" Like "ТР-##"): r = r + 1
    ws.Cells(r, 1).Value = "StrComp": ws.Cells(r, 2).Value = StrComp("abc", "ABC", vbTextCompare): r = r + 1
    ws.Cells(r, 1).Value = "Concat": ws.Cells(r, 2).Value = "Итого: " & 98100 & " руб.": r = r + 1
    ws.Cells(r, 1).Value = "Binary =": ws.Cells(r, 2).Value = ("abc" = "ABC"): r = r + 1
End Sub
