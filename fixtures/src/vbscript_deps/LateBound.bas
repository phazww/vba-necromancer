Option Explicit

Public Sub HasDigits()
    Dim re As Object
    Set re = CreateObject("VBScript.RegExp")
    re.Pattern = "[0-9]+"
    Range("B1").Value = re.Test(Range("B2").Value)
End Sub
