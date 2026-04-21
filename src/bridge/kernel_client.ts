/**
 * Kernel Client - Connects Shinobi to OpenGravity Kernel
 */

import http from 'http';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../.env'), override: true });

const KERNEL_URL = process.env.KERNEL_URL || `http://localhost:${process.env.AUDIT_PORT || 9998}`;

export interface MissionResult {
  success: boolean;
  missionId?: string;
  status?: string;
  progress?: number;
  logs?: string[];
  error?: string;
}

export class KernelClient {
  
  /**
   * Check if kernel is running
   */
  static async isOnline(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`${KERNEL_URL}/health`, { timeout: 2000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }
  
  /**
   * Start a new mission
   */
  static async startMission(objective: string): Promise<MissionResult> {
    return new Promise((resolve) => {
      const data = JSON.stringify({ objective });
      
      const req = http.request(`${KERNEL_URL}/mission/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 60000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve({ success: false, error: 'Invalid response' });
          }
        });
      });
      
      req.on('error', (e) => {
        resolve({ success: false, error: e.message });
      });
      
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Request timeout' });
      });
      
      req.write(data);
      req.end();
    });
  }
  
  /**
   * Get mission status
   */
  static async getMissionStatus(missionId: string): Promise<MissionResult> {
    return new Promise((resolve) => {
      const req = http.get(`${KERNEL_URL}/mission/${missionId}`, { timeout: 5000 }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve({ success: true, ...data });
          } catch (e) {
            resolve({ success: false, error: 'Invalid response' });
          }
        });
      });
      
      req.on('error', (e) => {
        resolve({ success: false, error: e.message });
      });
    });
  }
  
  /**
   * Wait for mission to complete
   */
  static async waitForMission(missionId: string, maxWaitMs: number = 120000): Promise<MissionResult> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.getMissionStatus(missionId);
      
      if (!status.success) {
        return status;
      }
      
      if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
        return status;
      }
      
      // Wait 1 second before checking again
      await new Promise(r => setTimeout(r, 1000));
    }
    
    return { success: false, error: 'Mission timeout' };
  }
}
