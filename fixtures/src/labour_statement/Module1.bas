Option Explicit

Function RateFor(ByVal grade As Integer) As Double
    Select Case grade
        Case 2: RateFor = 250
        Case 3: RateFor = 280
        Case 4: RateFor = 310
        Case 5: RateFor = 350
        Case 6: RateFor = 400
        Case Else: RateFor = 0
    End Select
End Function

Sub CalcPay()
    Dim ws As Worksheet
    Dim r As Long, hours As Double, basePay As Double, bonus As Double
    Dim totalPay As Double, totalHours As Double

    Set ws = Worksheets("Бригада")
    ws.Range("D1").Value = "Оклад"
    ws.Range("E1").Value = "Премия"
    ws.Range("F1").Value = "Итого"
    r = 2
    Do While Len(Trim(ws.Cells(r, 1).Value)) > 0
        hours = ws.Cells(r, 3).Value
        totalHours = totalHours + hours
        If hours = 0 Then
            ws.Cells(r, 4).Value = "не работал"
            ws.Cells(r, 5).Value = 0
            ws.Cells(r, 6).Value = 0
        Else
            basePay = hours * RateFor(ws.Cells(r, 2).Value)
            If hours >= 160 Then
                bonus = Round(basePay * 0.1, 2)
            Else
                bonus = 0
            End If
            ws.Cells(r, 4).Value = basePay
            ws.Cells(r, 5).Value = bonus
            ws.Cells(r, 6).Value = basePay + bonus
            totalPay = totalPay + basePay + bonus
        End If
        r = r + 1
    Loop
    ws.Cells(r, 1).Value = "Итого"
    ws.Cells(r, 3).Value = totalHours
    ws.Cells(r, 6).Value = totalPay
End Sub
