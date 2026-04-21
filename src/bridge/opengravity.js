import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

function detectLanguage(code) {
    const firstLine = code.split('\n')[0].trim();
    if (firstLine === '#!/bin/bash' || firstLine === '#!/usr/bin/env bash') {
        return 'bash';
    }
    if (
        code.includes('import ') ||
        code.includes('def ') ||
        code.includes('print(') ||
        code.includes('elif ') ||
        code.includes(':\n')
    ) {
        return 'python';
    }
    return 'node';
}

export class OpenGravityBridge {
    async audit(targetFile, contextDir) {
        const sourcePath = path.join(contextDir || process.cwd(), targetFile);

        if (!fs.existsSync(sourcePath)) {
            return {
                verdict: 'INVALID_TEST',
                code: targetFile,
                execution_result: { ran: false, exit_code: null, stdout: '', stderr: `File not found: ${sourcePath}` },
                audit: { status: 'NON_FUNCTIONAL_AGENT', error: `File not found: ${sourcePath}` }
            };
        }

        const rawCode = fs.readFileSync(sourcePath, 'utf8');
        let cleanCode = rawCode;

        if (rawCode.includes('```')) {
            const parts = rawCode.split('```');
            if (parts.length > 1) {
                const block = parts[1];
                const firstNewline = block.indexOf('\n');
                cleanCode = firstNewline !== -1 ? block.substring(firstNewline + 1).trim() : block.trim();
            }
        }

        const tmpDir = path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        const cleanCodeFiltered = cleanCode
            .replace(/```python|```javascript|```typescript|```bash|```sh|```js|```ts|```/gi, '')
            .trim();

        const lang = detectLanguage(cleanCodeFiltered);
        const scriptPath = path.join(tmpDir, 'sre_task.tmp');

        const VENV_PYTHON = process.platform === 'win32'
            ? 'C:\\Users\\angel\\Desktop\\OpenGravity\\sandbox_venv\\Scripts\\python.exe'
            : 'C:/Users/angel/Desktop/OpenGravity/sandbox_venv/bin/python';

        let finalPath, cmd, args;

        if (lang === 'bash') {
            finalPath = scriptPath.replace('.tmp', '.sh');
            fs.writeFileSync(finalPath, cleanCodeFiltered, 'utf8');
            cmd = process.platform === 'win32' ? 'C:\\Windows\\System32\\bash.exe' : 'bash';
            const wslPath = finalPath.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => '/mnt/' + d.toLowerCase());
            args = process.platform === 'win32' ? [wslPath] : [finalPath];
        } else if (lang === 'python') {
            finalPath = scriptPath.replace('.tmp', '.py');
            cmd = VENV_PYTHON;
            args = [finalPath];
        } else {
            finalPath = scriptPath.replace('.tmp', '.cjs');
            cmd = 'node';
            args = [finalPath];
        }

        fs.writeFileSync(finalPath, cleanCodeFiltered, 'utf8');

        const result = spawnSync(cmd, args, {
            encoding: 'utf8',
            cwd: process.cwd(),
            timeout: 30000
        });

        const stdout = result.stdout?.trim() || '';
        const stderr = result.stderr?.trim() || '';
        const exit_code = result.status ?? -1;
        const ran = result.status !== null;
        const success = ran && exit_code === 0;

        const execution_result = { ran, exit_code, stdout, stderr };

        if (success) {
            return {
                verdict: 'VALID_TEST',
                lang,
                code: cleanCodeFiltered,
                execution_result,
                audit: { status: 'FUNCTIONAL_AGENT', output: stdout || 'OK' }
            };
        } else {
            return {
                verdict: 'INVALID_TEST',
                lang,
                code: cleanCodeFiltered,
                execution_result,
                audit: { status: 'NON_FUNCTIONAL_AGENT', error: stderr || `exit code ${exit_code}` }
            };
        }
    }
}
