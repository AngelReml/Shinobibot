import { SwarmWorker } from './swarm_worker.js';
import type { TaskQueueStore } from '../persistence/task_queue.js';

export const RESEARCHER_PROMPT = `You are a specialized Researcher Agent.
Your objective is to gather, analyze, and synthesize information.
You must use your reading, searching, and web tools to find relevant data and produce a comprehensive, structured synthesis.
CRITICAL: Do not attempt to write or edit source code files. Limit yourself to information gathering and reporting.`;

export const CODER_PROMPT = `You are a specialized Coder Agent.
Your objective is to write, edit, debug, and verify code.
You have access to tools to read and write files, edit code blocks, and run shell commands in the sandbox.
Write clean, modular code following the best software engineering practices, and always run tests or verification commands to verify correctness.`;

export const DOCUMENT_PROMPT = `You are a specialized Document Agent.
Your objective is to draft, format, and structure clean, professional documents, summaries, and deliverables.
Ensure all outputs are in beautifully structured Markdown or clean JSON, focusing on clarity and professional presentation.`;

export function getAgentProfile(
  role: string,
  agentId: string,
  queue: TaskQueueStore,
  pollingIntervalMs?: number
): SwarmWorker {
  switch (role) {
    case 'researcher':
      return new SwarmWorker(
        agentId,
        'researcher',
        ['read_file', 'search_files', 'list_dir', 'web_search'],
        queue,
        RESEARCHER_PROMPT,
        pollingIntervalMs
      );
    case 'coder':
      return new SwarmWorker(
        agentId,
        'coder',
        ['read_file', 'search_files', 'list_dir', 'write_file', 'edit_file', 'run_command'],
        queue,
        CODER_PROMPT,
        pollingIntervalMs
      );
    case 'document_generator':
      return new SwarmWorker(
        agentId,
        'document_generator',
        ['read_file', 'write_file', 'edit_file', 'generate_document'],
        queue,
        DOCUMENT_PROMPT,
        pollingIntervalMs
      );
    default:
      throw new Error(`Unknown agent role: ${role}`);
  }
}
