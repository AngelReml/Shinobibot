/**
 * KillSwitch (B9): ESC held >= 1s aborts the screen_act loop.
 * Implemented via a child PowerShell process polling Win32 GetAsyncKeyState(VK_ESCAPE=0x1B).
 * The PS loop emits the line "STOP" on stdout once the threshold is reached.
 */
import { spawn, ChildProcess } from 'child_process';

const PS_SCRIPT = `
Add-Type -Name 'KS' -Namespace 'Win' -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);'
$start = $null
while ($true) {
  $state = [Win.KS]::GetAsyncKeyState(27)
  $down  = ($state -band 0x8000) -ne 0
  if ($down) {
    if ($null -eq $start) { $start = Get-Date }
    elseif (((Get-Date) - $start).TotalMilliseconds -ge 1000) {
      Write-Output 'STOP'
      [Console]::Out.Flush()
      Start-Sleep -Milliseconds 200
      $start = $null
    }
  } else { $start = $null }
  Start-Sleep -Milliseconds 50
}
`;

export class KillSwitch {
  private static proc: ChildProcess | null = null;
  private static stopRequested = false;

  static start(): void {
    if (this.proc) return;
    this.stopRequested = false;
    try {
      this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      this.proc.stdout?.setEncoding('utf-8');
      this.proc.stdout?.on('data', (chunk: string) => {
        if (chunk.includes('STOP')) this.stopRequested = true;
      });
      this.proc.on('exit', () => { this.proc = null; });
    } catch {
      this.proc = null;
    }
  }

  static stop(): void {
    if (this.proc) {
      try { this.proc.kill(); } catch { /* ignore */ }
      this.proc = null;
    }
    this.stopRequested = false;
  }

  static shouldAbort(): boolean { return this.stopRequested; }

  static reset(): void { this.stopRequested = false; }
}
