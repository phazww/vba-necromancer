Option Explicit

Sub BuildActs()
    Dim src As Worksheet, dst As Worksheet
    Dim lastRow As Long, i As Long, k As Long, n As Long
    Dim cats(1 To 10) As String
    Dim vol(1 To 10) As Double, hrs(1 To 10) As Double, amt(1 To 10) As Double
    Dim cat As String, found As Boolean

    Set src = Worksheets("Журнал")
    Set dst = Worksheets("Акты")
    lastRow = src.Cells(src.Rows.Count, 1).End(xlUp).Row
    n = 0
    For i = 2 To lastRow
        cat = Trim(src.Cells(i, 3).Value)
        found = False
        For k = 1 To n
            If cats(k) = cat Then
                found = True
                Exit For
            End If
        Next k
        If Not found Then
            n = n + 1
            cats(n) = cat
            k = n
        End If
        vol(k) = vol(k) + src.Cells(i, 4).Value
        hrs(k) = hrs(k) + src.Cells(i, 4).Value * src.Cells(i, 5).Value
        amt(k) = amt(k) + src.Cells(i, 4).Value * src.Cells(i, 6).Value
    Next i

    dst.Range("A1").Value = "Категория"
    dst.Range("B1").Value = "Объём"
    dst.Range("C1").Value = "Чел.-ч"
    dst.Range("D1").Value = "Сумма"
    For k = 1 To n
        dst.Cells(k + 1, 1).Value = cats(k)
        dst.Cells(k + 1, 2).Value = vol(k)
        dst.Cells(k + 1, 3).Value = Round(hrs(k), 2)
        dst.Cells(k + 1, 4).Value = Round(amt(k), 2)
    Next k
    dst.Cells(n + 2, 1).Value = "Итого"
    dst.Cells(n + 2, 4).Value = Application.WorksheetFunction.Sum(dst.Range(dst.Cells(2, 4), dst.Cells(n + 1, 4)))
End Sub
