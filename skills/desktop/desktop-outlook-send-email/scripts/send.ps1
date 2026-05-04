# desktop-outlook-send-email — PowerShell helper
# Receives JSON over -Args (positional argument 1) to avoid quoting hell.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true, Position=0)][string]$ArgsJson
)
$ErrorActionPreference = 'Stop'
$outlook = $null
$mail = $null
try {
    $params = $ArgsJson | ConvertFrom-Json
    foreach ($req in @('to','subject','body')) {
        if (-not $params.PSObject.Properties.Name.Contains($req)) {
            Write-Output (@{ success=$false; error="missing parameter: $req" } | ConvertTo-Json -Compress)
            exit 1
        }
    }
    try {
        $outlook = New-Object -ComObject Outlook.Application
    } catch {
        Write-Output (@{ success=$false; error="Outlook not available: $($_.Exception.Message)" } | ConvertTo-Json -Compress)
        exit 1
    }
    $mail = $outlook.CreateItem(0)  # olMailItem
    $mail.To = $params.to
    if ($params.cc)  { $mail.CC = $params.cc }
    if ($params.bcc) { $mail.BCC = $params.bcc }
    $mail.Subject = $params.subject
    if ($params.html) {
        $mail.BodyFormat = 2  # HTML
        $mail.HTMLBody = $params.body
    } else {
        $mail.Body = $params.body
    }
    $attachErrors = @()
    if ($params.attachments) {
        foreach ($f in $params.attachments) {
            if (Test-Path -LiteralPath $f) { $mail.Attachments.Add($f) | Out-Null }
            else { $attachErrors += "missing: $f" }
        }
    }
    if ($params.display) {
        $mail.Display($false)
        Write-Output (@{ success=$true; sent=$false; displayed=$true; to=$params.to; subject=$params.subject; attachment_errors=$attachErrors } | ConvertTo-Json -Compress)
    } else {
        $mail.Send()
        Write-Output (@{ success=$true; sent=$true; to=$params.to; subject=$params.subject; attachment_errors=$attachErrors } | ConvertTo-Json -Compress)
    }
} catch {
    Write-Output (@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress)
    exit 1
} finally {
    if ($mail -ne $null) {
        [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($mail) | Out-Null
    }
    if ($outlook -ne $null) {
        [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($outlook) | Out-Null
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
