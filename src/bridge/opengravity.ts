import fs from 'fs';
import path from 'path';
import { run_command } from '../utils/runner.ts';

export class OpenGravityBridge {
  private kernelPath: string;

  constructor(kernelPath: string = 'c:/Users/angel/Desktop/OpenGravity') {
    this.kernelPath = kernelPath;
  }

  async audit(code: string, fileName: string) {
    const tmpDir = path.join(this.kernelPath, 'tmp', 'shinobibot_audit');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const filePath = path.join(tmpDir, fileName);
    fs.writeFileSync(filePath, code);

    // Guarantee entrypoint discovery by adding a minimal package.json
    const pkgJson = {
      name: "shinobibot-audit",
      version: "1.0.0",
      main: fileName,
      type: "module",
      scripts: {
        start: `node --esm ${fileName}`
      }
    };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

    console.log(`[OpenGravity] Triggering Audit for ${fileName}...`);
    try {
      // Trigger the OpenGravity V3 Kernel on the temp folder
      // We assume the kernel script is run_agent_sandbox.ts
      await run_command(`npx ts-node run_agent_sandbox.ts tmp/shinobibot_audit`, this.kernelPath);

      return {
        status: 'SUCCESSFUL_AUDIT',
        path: filePath,
        report: path.join(this.kernelPath, 'reports', 'EXECUTIVE_TRUTH_REPORT.md')
      };
    } catch (error: any) {
      console.error(`[OpenGravity] Audit Failed: ${error.message}`);
      return {
        status: 'NON_FUNCTIONAL_AGENT',
        error: error.message
      };
    }
  }
}
