import { MissionsStore, type RecurrentMission } from '../persistence/missions_recurrent.js';
import { Notifier } from '../notifications/notifier.js';
import { ShinobiOrchestrator } from '../coordinator/orchestrator.js';

export class ResidentLoop {
  private store: MissionsStore;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private tickIntervalMs = 30000; // 30s

  constructor(store?: MissionsStore) {
    this.store = store || new MissionsStore();
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[ResidentLoop] started. Tick interval: ' + (this.tickIntervalMs / 1000) + 's');
    this.scheduleNext();
  }

  public stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    console.log('[ResidentLoop] stopped.');
  }

  public isRunning(): boolean { return this.running; }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      try {
        await this.tick();
      } catch (e: any) {
        console.error('[ResidentLoop] tick error:', e.message);
      }
      this.scheduleNext();
    }, this.tickIntervalMs);
  }

  private async tick(): Promise<void> {
    const due = this.store.getDueMissions();
    if (due.length === 0) return;
    for (const m of due) {
      await this.runMission(m);
    }
  }

  private async runMission(m: RecurrentMission): Promise<void> {
    console.log(`[ResidentLoop] running mission ${m.id} (${m.name})`);
    try {
      const result = await ShinobiOrchestrator.process(m.prompt);
      const outputStr = typeof result === 'string' ? result : JSON.stringify(result);
      this.store.recordRun(m.id, 'success', outputStr);
      console.log(`[ResidentLoop] mission ${m.id} OK`);
    } catch (e: any) {
      const errMsg = e.message || String(e);
      this.store.recordRun(m.id, 'failure', null, errMsg);
      console.error(`[ResidentLoop] mission ${m.id} FAILED: ${errMsg}`);

      const updated = this.store.get(m.id);
      if (updated && updated.consecutive_failures === 3) {
        await Notifier.send({
          level: 'error',
          title: `Mission "${m.name}" disabled after 3 failures`,
          body: `Last error: ${errMsg.substring(0, 500)}`,
          context: { mission_id: m.id }
        });
      }
    }
  }

  public getStore(): MissionsStore { return this.store; }
}
