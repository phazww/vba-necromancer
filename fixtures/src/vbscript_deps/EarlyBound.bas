Option Explicit

Public Sub CountDigitRuns()
    Dim re As New RegExp
    re.Pattern = "[0-9]+"
    re.Global = True
    Range("A1").Value = re.Execute(Range("A2").Value).Count
End Sub
