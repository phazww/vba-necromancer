Option Explicit

Sub NumericChecks()
    Dim ws As Worksheet
    Dim i As Integer, big As Long, r As Long
    Set ws = Worksheets("Numbers")
    r = 1
    ws.Cells(r, 1).Value = "CInt(2.5)": ws.Cells(r, 2).Value = CInt(2.5): r = r + 1
    ws.Cells(r, 1).Value = "CInt(3.5)": ws.Cells(r, 2).Value = CInt(3.5): r = r + 1
    ws.Cells(r, 1).Value = "CLng(-2.5)": ws.Cells(r, 2).Value = CLng(-2.5): r = r + 1
    ws.Cells(r, 1).Value = "7 \ 2": ws.Cells(r, 2).Value = 7 \ 2: r = r + 1
    ws.Cells(r, 1).Value = "7.5 \ 2": ws.Cells(r, 2).Value = 7.5 \ 2: r = r + 1
    ws.Cells(r, 1).Value = "-7 \ 2": ws.Cells(r, 2).Value = -7 \ 2: r = r + 1
    ws.Cells(r, 1).Value = "5.5 Mod 2": ws.Cells(r, 2).Value = 5.5 Mod 2: r = r + 1
    ws.Cells(r, 1).Value = "-7 Mod 3": ws.Cells(r, 2).Value = -7 Mod 3: r = r + 1
    ws.Cells(r, 1).Value = "Round(2.5)": ws.Cells(r, 2).Value = Round(2.5): r = r + 1
    ws.Cells(r, 1).Value = "Round(3.5)": ws.Cells(r, 2).Value = Round(3.5): r = r + 1
    ws.Cells(r, 1).Value = "Int(-2.5)": ws.Cells(r, 2).Value = Int(-2.5): r = r + 1
    ws.Cells(r, 1).Value = "Fix(-2.5)": ws.Cells(r, 2).Value = Fix(-2.5): r = r + 1
    ws.Cells(r, 1).Value = "2 ^ 10": ws.Cells(r, 2).Value = 2 ^ 10: r = r + 1
    ws.Cells(r, 1).Value = "10 / 4": ws.Cells(r, 2).Value = 10 / 4: r = r + 1

    On Error Resume Next
    i = 32767
    i = i + 1
    ws.Cells(r, 1).Value = "Err after overflow": ws.Cells(r, 2).Value = Err.Number: r = r + 1
    ws.Cells(r, 1).Value = "i kept": ws.Cells(r, 2).Value = i: r = r + 1
    Err.Clear
    On Error GoTo 0

    big = 32767
    big = big + 1
    ws.Cells(r, 1).Value = "Long 32768": ws.Cells(r, 2).Value = big: r = r + 1
End Sub
