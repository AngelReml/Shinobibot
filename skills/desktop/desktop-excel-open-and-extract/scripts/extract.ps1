# desktop-excel-open-and-extract — PowerShell helper
# Usage: powershell -NoProfile -File extract.ps1 -Path <abs.xlsx> [-Sheet name] [-Range A1:D10] [-HeaderRow] [-Visible]
# Emits JSON to stdout. Always closes Excel and releases COM objects on exit.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Path,
    [string]$Sheet = "",
    [string]$Range = "",
    [switch]$HeaderRow,
    [switch]$Visible,
    [switch]$KeepOpen
)

$ErrorActionPreference = 'Stop'
$excel = $null
$wb = $null
try {
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Output (@{ success=$false; error="file not found: $Path" } | ConvertTo-Json -Compress)
        exit 1
    }
    try {
        $excel = New-Object -ComObject Excel.Application
    } catch {
        Write-Output (@{ success=$false; error="Could not load Excel.Application: $($_.Exception.Message)" } | ConvertTo-Json -Compress)
        exit 1
    }
    $excel.Visible = [bool]$Visible
    $excel.DisplayAlerts = $false

    $wb = $excel.Workbooks.Open($Path, $false, $true)
    $ws = if ($Sheet) { $wb.Worksheets.Item($Sheet) } else { $wb.Worksheets.Item(1) }
    $area = if ($Range) { $ws.Range($Range) } else { $ws.UsedRange }

    $rows = $area.Rows.Count
    $cols = $area.Columns.Count
    $values = $area.Value2

    $matrix = New-Object 'object[,]' ($rows, $cols)
    if ($rows -eq 1 -and $cols -eq 1) {
        $matrix[0, 0] = $values
    } else {
        for ($r = 1; $r -le $rows; $r++) {
            for ($c = 1; $c -le $cols; $c++) {
                $matrix[$r - 1, $c - 1] = $values[$r, $c]
            }
        }
    }

    $output = @{
        sheet = $ws.Name
        range = $area.Address($false, $false)
        row_count = $rows
        column_count = $cols
    }

    if ($HeaderRow -and $rows -ge 2) {
        $headers = @()
        for ($c = 0; $c -lt $cols; $c++) {
            $headers += [string]$matrix[0, $c]
        }
        $records = @()
        for ($r = 1; $r -lt $rows; $r++) {
            $rec = [ordered]@{}
            for ($c = 0; $c -lt $cols; $c++) {
                $rec[$headers[$c]] = $matrix[$r, $c]
            }
            $records += [pscustomobject]$rec
        }
        $output.rows = $records
        $output.row_count = $records.Count
    } else {
        $arr = @()
        for ($r = 0; $r -lt $rows; $r++) {
            $row = @()
            for ($c = 0; $c -lt $cols; $c++) {
                $row += $matrix[$r, $c]
            }
            $arr += ,$row
        }
        $output.rows = $arr
    }

    $output.success = $true
    Write-Output ($output | ConvertTo-Json -Depth 8 -Compress)
} catch {
    Write-Output (@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress)
    exit 1
} finally {
    if ($wb -ne $null) {
        try { $wb.Close($false) } catch {}
        [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($wb) | Out-Null
    }
    if ($excel -ne $null -and -not $KeepOpen) {
        try { $excel.Quit() } catch {}
        [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) | Out-Null
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
