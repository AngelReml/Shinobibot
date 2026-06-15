/**
 * shugyo/surface/cli_parser.ts — CLI surface discovery (dossier §8.1, régimen
 * tratable). Parse `--help` output into a command/flag tree. Grade STRONG: the
 * surface is explicit and verifiable. Pure (the help text is captured in sandbox
 * by the caller; parsing it is deterministic and testable with fixtures).
 */

export interface CliFlag { flag: string; alias?: string; takesArg: boolean; description: string; }
export interface CliSubcommand { name: string; description: string; }
export interface CliSurface { flags: CliFlag[]; subcommands: CliSubcommand[]; }

const FLAG_LINE = /^\s+(-[A-Za-z],\s*)?(--?[A-Za-z][\w-]*)(\s+[<\[][^>\]]+[>\]]|\s+[A-Z_]+)?\s{2,}(.+)$/;
const SUB_LINE = /^\s+([a-z][\w-]+)\s{2,}(.+)$/;

/** Parse help text into a CLI surface. Recognizes a "Commands:" section for subcommands. */
export function parseCliHelp(text: string): CliSurface {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const flags: CliFlag[] = [];
  const subcommands: CliSubcommand[] = [];
  let inCommands = false;

  for (const line of lines) {
    if (/^\s*(commands|subcommands|available commands)\s*:?\s*$/i.test(line)) { inCommands = true; continue; }
    if (/^\s*(options|flags|arguments)\s*:?\s*$/i.test(line)) { inCommands = false; continue; }

    const fm = FLAG_LINE.exec(line);
    if (fm) {
      const alias = fm[1] ? fm[1].replace(/[,\s]/g, '') : undefined;
      flags.push({ flag: fm[2], alias, takesArg: !!fm[3], description: fm[4].trim() });
      continue;
    }
    if (inCommands) {
      const sm = SUB_LINE.exec(line);
      if (sm && !sm[1].startsWith('-')) subcommands.push({ name: sm[1], description: sm[2].trim() });
    }
  }
  return { flags: dedup(flags, (f) => f.flag), subcommands: dedup(subcommands, (s) => s.name) };
}

function dedup<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
}
