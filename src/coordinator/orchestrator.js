/**
 * Shinobi Orchestrator v2
 * Routes requests to either local execution or OpenGravity Kernel
 */
import { KernelClient } from '../bridge/kernel_client.js';
import { LLMGateway } from '../gateway/llm.js';
import { OpenGravityBridge } from '../bridge/opengravity.js';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
export class ShinobiOrchestrator {
    static mode = 'auto';
    static setMode(mode) {
        this.mode = mode;
        console.log(`[Shinobi] Mode set to: ${mode}`);
    }
    /**
     * Main entry point for processing user requests
     */
    static async process(input) {
        console.log(`[Shinobi] Processing: ${input.slice(0, 50)}...`);
        // Check if kernel is available
        const kernelOnline = await KernelClient.isOnline();
        // Determine execution mode
        let useKernel = false;
        if (this.mode === 'kernel') {
            useKernel = kernelOnline;
            if (!kernelOnline) {
                console.warn('[Shinobi] Kernel mode requested but kernel is offline. Falling back to local.');
            }
        }
        else if (this.mode === 'auto') {
            // Use kernel for complex tasks, local for simple ones
            const isComplexTask = this.isComplexTask(input);
            useKernel = kernelOnline && isComplexTask;
        }
        // mode === 'local' → useKernel stays false
        if (useKernel) {
            return this.executeViaKernel(input);
        }
        else {
            return this.executeLocally(input);
        }
    }
    /**
     * Determine if a task is complex enough to warrant kernel execution
     */
    static isComplexTask(input) {
        const lower = input.toLowerCase();
        // Filesystem-only tasks → force local, not kernel
        const isFilesystemOnly = /crea|escribe|guarda|lista|lee|archivo|carpeta|fichero/i.test(lower)
            && !/analiza|investiga|compara|estrategia|report/i.test(lower);
        if (isFilesystemOnly) return false;
        // Complex indicators
        const complexPatterns = [
            'analiza', 'analyze', 'investiga', 'research',
            'planifica', 'plan', 'estrategia', 'strategy',
            'compara', 'compare', 'evalua', 'evaluate',
            'informe', 'report', 'documento', 'document',
            'multiples', 'multiple', 'varios', 'several',
            'proyecto', 'project', 'sistema', 'system'
        ];
        return complexPatterns.some(p => lower.includes(p));
    }
    /**
     * Execute via OpenGravity Kernel (for complex tasks)
     */
    static async executeViaKernel(input) {
        console.log('[Shinobi] Delegating to OpenGravity Kernel...');
        const result = await KernelClient.startMission(input);
        if (!result.success) {
            console.error('[Shinobi] Kernel error:', result.error);
            return { verdict: 'KERNEL_ERROR', error: result.error };
        }
        console.log(`[Shinobi] Mission started: ${result.missionId}`);
        // Wait for completion
        const finalResult = await KernelClient.waitForMission(result.missionId, 120000);
        return {
            verdict: finalResult.status === 'completed' ? 'VALID_AGENT' : 'EXECUTION_FAILED',
            mode: 'kernel',
            missionId: result.missionId,
            status: finalResult.status,
            progress: finalResult.progress,
            logs: finalResult.logs
        };
    }
    /**
     * Execute locally (for simple tasks - original Shinobi behavior)
     */
    static async executeLocally(input) {
        console.log('[Shinobi] Executing locally...');
        // Detect web search requests and handle via Playwright
        const isWebSearch = /busca|search|google|bing|web|browser|navega|abre\s+(el\s+)?navegador|abre\s+\w+\.(com|es|org|io)|youtube|twitter|reddit|instagram/i.test(input);
        // Route install/run/messaging tasks directly to terminal (before web search check)
        const isTerminalTask = /instala|install|pip\s+install|npm\s+install|ejecuta|run|whatsapp|telegram|email|envías?|send/i.test(input)
            || (/\b(abre|open)\b/i.test(input) && !isWebSearch);
        if (isTerminalTask) {
            console.log('[Shinobi] Terminal task detected, bypassing LLM codegen...');
            return this.executeWithTerminal(input);
        }
        if (isWebSearch) {
            try {
                const { chromium } = await import('playwright');
                let stdout;
                const isYouTube = /youtube|abre youtube/i.test(input);

                // Connect to CDP
                const browser = await chromium.connectOverCDP('http://localhost:9222');
                const allContexts = browser.contexts();

                // Get ALL pages across ALL contexts
                const allPages = allContexts.flatMap(ctx => ctx.pages());

                // Log all open URLs for debugging
                console.log('[Shinobi] Open tabs:', allPages.map(p => p.url()));

                const domainMatch = input.match(/\b([\w-]+\.(com|es|org|io))\b/i);
                const targetDomain = isYouTube ? 'youtube.com' : (domainMatch ? domainMatch[1] : null);

                let page = null;
                let isNewPage = false;

                if (targetDomain) {
                    // Find existing page with that domain in allPages
                    page = allPages.find(p => p.url().includes(targetDomain));
                    if (page) {
                        // Use it directly WITHOUT navigating
                        console.log(`[Shinobi] Reusing existing tab: ${page.url()}`);
                        await page.evaluate(() => window.scrollBy(0, 500));
                        await page.waitForTimeout(3000);
                        await page.screenshot({ path: 'C:\\Users\\angel\\Desktop\\youtube_debug.png' });
                        const pageSource = await page.evaluate(() => document.body.innerHTML.substring(0, 500));
                        console.log('[Shinobi] Page source preview:', pageSource);
                    } else {
                        // Create new page in allContexts[0], navigate, wait
                        const ctx = allContexts[0] || await browser.newContext();
                        page = await ctx.newPage();
                        isNewPage = true;
                        await page.goto(`https://${targetDomain}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        if (isYouTube) {
                            await page.waitForSelector('ytd-rich-item-renderer', { timeout: 15000 });
                        } else {
                            await page.waitForTimeout(4000);
                        }
                    }

                    if (isYouTube) {
                        const firstVideoTitle = await page.evaluate(() => {
                            const selectors = [
                                'ytd-rich-item-renderer #video-title',
                                'ytd-compact-video-renderer #video-title',
                                'a#video-title-link',
                                '#video-title',
                            ];
                            for (const sel of selectors) {
                                for (const el of document.querySelectorAll(sel)) {
                                    const texto = el.textContent ? el.textContent.trim() : "";
                                    if (texto.length > 3 && texto !== "Saltar navegación") {
                                        return texto;
                                    }
                                }
                            }
                            return "Error: No se encontraron títulos con texto";
                        });

                        console.log(`[Shinobi] Título extraído con éxito: ${firstVideoTitle}`);

                        let output = `Page: YouTube\n`;
                        if (firstVideoTitle) {
                            output += `First recommended video title: ${firstVideoTitle}`;
                        } else {
                            const tabTitle = await page.title();
                            output += `No valid video title found. Tab title was: ${tabTitle}`;
                            try {
                                await page.screenshot({ path: 'debug_youtube.png', fullPage: false });
                                output += `\nScreenshot saved as debug_youtube.png for analysis`;
                            } catch (sErr) {
                                output += `\n(Screenshot failed: ${sErr.message})`;
                            }
                        }
                        stdout = output;
                    } else {
                        const content = await page.evaluate(() => {
                            return { title: document.title, first: 'Direct navigation' };
                        });
                        stdout = `Page: ${content.title}\nStatus: ${content.first}`;
                    }
                } else {
                    // No domain match → Bing search on new page
                    const ctx = allContexts[0] || await browser.newContext();
                    page = await ctx.newPage();
                    isNewPage = true;
                    const cleanQuery = input.replace(/busca\s+(en\s+google\s+)?|search\s+(for\s+)?/gi, '').trim();
                    await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(cleanQuery)}`, { waitUntil: 'domcontentloaded' });
                    await page.waitForSelector('h2 a', { timeout: 10000 }).catch(() => {});
                    const results = await page.evaluate(() => {
                        return Array.from(document.querySelectorAll('h2 a')).slice(0, 3).map(a => {
                            return { title: a.innerText.trim(), link: a.href };
                        });
                    });
                    stdout = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.link}`).join('\n\n');
                }

                // Don't close pages that were already open
                if (isNewPage) await page.close();
                return {
                    verdict: 'VALID_TEST',
                    mode: 'local',
                    execution_result: { ran: true, exit_code: 0, stdout, stderr: '' },
                    audit: { status: 'FUNCTIONAL_AGENT', output: stdout }
                };
            } catch (err) {
                return { verdict: 'INVALID_TEST', error: `Playwright Error: ${err.message}` };
            }
        }
        // Generate code via LLM
        const gateway = new LLMGateway();
        const prompt = `Act as a senior SRE. Your task is to generate a standalone TypeScript or Python script that validates: ${input}. 
Return ONLY the raw code inside a markdown block.
If generating bash scripts: use only POSIX-compatible bash without external tools like jq, inotifywait, or notify-send. Use only built-in bash commands: echo, cat, ls, find, date, mkdir, cp, mv, stat, while, for loops, and standard redirections.`;
        try {
            const code = await gateway.chat([{ role: 'user', content: prompt }], { provider: 'openai' });
            if (!code) {
                return {
                    verdict: 'INVALID_TEST',
                    error: 'LLM failed to generate code'
                };
            }
            // Save to temp file
            const tmpDir = path.join(process.cwd(), 'tmp');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }
            const tmpFile = path.join(tmpDir, 'generated_code.ts');
            fs.writeFileSync(tmpFile, code, 'utf8');
            // Execute via OpenGravity bridge
            const bridge = new OpenGravityBridge();
            const result = await bridge.audit('generated_code.ts', tmpDir);
            if (result.verdict === 'INVALID_TEST') {
                return result;
            }
            return {
                verdict: result.verdict,
                mode: 'local',
                code: result.code ?? code,
                lang: result.lang,
                execution_result: result.execution_result,
                audit: result.audit
            };
        }
        catch (err) {
            return {
                verdict: 'INVALID_TEST',
                error: `LLM Error: ${err.message}`
            };
        }
    }
    /**
     * Generate and run a shell command via LLM to accomplish the task
     */
    static async executeWithTerminal(input) {
        console.log('[Shinobi] Executing via terminal...');
        const VENV_PIP = 'C:\\Users\\angel\\Desktop\\OpenGravity\\sandbox_venv\\Scripts\\pip.exe';
        const VENV_PYTHON = 'C:\\Users\\angel\\Desktop\\OpenGravity\\sandbox_venv\\Scripts\\python.exe';
        // Direct pip install — no need for LLM
        const pipMatch = input.match(/install\s+([\w\-\[\]]+)/i);
        if (pipMatch) {
            const pkg = pipMatch[1];
            const directCmd = `"${VENV_PIP}" install ${pkg}`;
            console.log(`[Shinobi] Direct pip install: ${directCmd}`);
            return new Promise((resolve) => {
                exec(directCmd, { timeout: 60000 }, (error, stdout, stderr) => {
                    resolve({
                        verdict: error ? 'INVALID_TEST' : 'VALID_TEST',
                        mode: 'terminal',
                        execution_result: { ran: true, exit_code: error?.code ?? 0, stdout, stderr },
                        audit: { status: error ? 'TERMINAL_FAILED' : 'TERMINAL_SUCCESS', output: stdout || stderr }
                    });
                });
            });
        }
        const gateway = new LLMGateway();
        const cmdPrompt = `Generate a single Windows CMD or PowerShell command to: ${input}. Return ONLY the command, no explanation.`;
        try {
            const command = await gateway.chat([{ role: 'user', content: cmdPrompt }], { provider: 'openai' });
            if (!command) {
                return { verdict: 'INVALID_TEST', error: 'LLM failed to generate terminal command' };
            }
            const cleanCmd = command.trim().replace(/^```[\w]*\n?|```$/gm, '').trim();
            const finalCmd = cleanCmd
                .replace(/^python\b/, VENV_PYTHON)
                .replace(/^pip\b/, VENV_PIP)
                .replace(/(?<=\s)python(?=\s|$)/, VENV_PYTHON)
                .replace(/(?<=\s)pip(?=\s|$)/, VENV_PIP);
            console.log(`[Shinobi] Running command: ${finalCmd}`);
            return new Promise((resolve) => {
                exec(finalCmd, { timeout: 30000 }, (error, stdout, stderr) => {
                    if (stderr.includes('ModuleNotFoundError: No module named')) {
                        this.autoInstallAndRetry(input, stderr).then(resolve);
                        return;
                    }
                    resolve({
                        verdict: error ? 'INVALID_TEST' : 'VALID_TEST',
                        mode: 'terminal',
                        execution_result: { ran: true, exit_code: error?.code ?? 0, stdout, stderr },
                        audit: { status: error ? 'TERMINAL_FAILED' : 'TERMINAL_SUCCESS', output: stdout || stderr }
                    });
                });
            });
        }
        catch (err) {
            return { verdict: 'INVALID_TEST', error: `Terminal Error: ${err.message}` };
        }
    }
    /**
     * Auto-install a missing Python module via pip and retry (max 2 retries)
     */
    static async autoInstallAndRetry(input, error, retries = 0) {
        if (retries >= 0) {
            return { verdict: 'INVALID_TEST', error: `Auto-retry disabled. Last error: ${error}` };
        }
        const match = error.match(/ModuleNotFoundError: No module named ['"]?([\w.-]+)['"]?/);
        if (!match) {
            return { verdict: 'INVALID_TEST', error: `Unhandled error: ${error}` };
        }
        const moduleName = match[1];
        console.log(`[Shinobi] Auto-installing missing module: ${moduleName}`);
        return new Promise((resolve) => {
            exec(`C:\\Users\\angel\\Desktop\\OpenGravity\\sandbox_venv\\Scripts\\pip.exe install ${moduleName}`, { timeout: 60000 }, (installErr, _out, installStderr) => {
                if (installErr) {
                    resolve({ verdict: 'INVALID_TEST', error: `pip install failed: ${installStderr}` });
                    return;
                }
                console.log(`[Shinobi] Installed ${moduleName}, retrying...`);
                this.executeWithTerminal(input).then(resolve);
            });
        });
    }
}
