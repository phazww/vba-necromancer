Option Explicit

Sub BuildActsDict()
    Dim src As Worksheet, dst As Worksheet
    Dim lastRow As Long, i As Long, r As Long
    Dim vol As Object, hrs As Object, amt As Object
    Dim cat As Variant, total As Double

    Set src = Worksheets("Журнал")
    Set dst = Worksheets("Акты")
    Set vol = CreateObject("Scripting.Dictionary")
    Set hrs = CreateObject("Scripting.Dictionary")
    Set amt = CreateObject("Scripting.Dictionary")

    lastRow = src.Cells(src.Rows.Count, 1).End(xlUp).Row
    For i = 2 To lastRow
        cat = Trim(src.Cells(i, 3).Value)
        If Not vol.Exists(cat) Then
            vol.Add cat, 0
            hrs.Add cat, 0
            amt.Add cat, 0
        End If
        vol(cat) = vol(cat) + src.Cells(i, 4).Value
        hrs(cat) = hrs(cat) + src.Cells(i, 4).Value * src.Cells(i, 5).Value
        amt(cat) = amt(cat) + src.Cells(i, 4).Value * src.Cells(i, 6).Value
    Next i

    dst.Range("A1").Value = "Категория"
    dst.Range("B1").Value = "Объём"
    dst.Range("C1").Value = "Чел.-ч"
    dst.Range("D1").Value = "Сумма"
    r = 2
    For Each cat In vol.Keys
        dst.Cells(r, 1).Value = cat
        dst.Cells(r, 2).Value = vol(cat)
        dst.Cells(r, 3).Value = Round(hrs(cat), 2)
        dst.Cells(r, 4).Value = Round(amt(cat), 2)
        total = total + Round(amt(cat), 2)
        r = r + 1
    Next cat
    dst.Cells(r, 1).Value = "Итого"
    dst.Cells(r, 4).Value = total
End Sub
