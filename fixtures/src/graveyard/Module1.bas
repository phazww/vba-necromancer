Option Explicit

Private Declare PtrSafe Function GetTickCount Lib "kernel32" () As Long

Sub ExportReport()
    Dim ws As Worksheet
    Set ws = Worksheets("Отчёт")
    ws.Range("A1").Value = "Отчёт сформирован"
    On Error Resume Next
    Dim fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    ws.Range("A2").Value = "после FSO"
    Open "C:\temp\report.txt" For Output As #1
    Print #1, "Отчёт"
    Close #1
    On Error GoTo 0
    ws.Range("A3").Value = "конец"
End Sub

Sub ExportStrict()
    Worksheets("Отчёт").Range("B1").Value = "до"
    Open "C:\temp\x.txt" For Output As #1
    Worksheets("Отчёт").Range("B2").Value = "не дойдёт"
End Sub
