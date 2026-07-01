// F2.14 - applyProposal integration test on temp git repo.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { applyProposal, type Proposal } from "../improvements.js";

function git(args: string[], cwd: string) {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function commitCount(cwd: string): number {
  const r = git(["rev-list", "--count", "HEAD"], cwd);
  return parseInt(r.stdout.trim() || "0", 10);
}

function buildValidDiff(cwd: string, targetFile: string, newContent: string): string {
  // Genera un diff unificado real via `git diff --no-index` entre el
  // contenido actual y el nuevo, luego reescribe las cabeceras para que
  // apunten al fichero real del repo (misma tecnica que usa internamente
  // improvements.ts en computeDiffForProposal).
  const before = path.join(cwd, targetFile);
  const afterTmp = path.join(os.tmpdir(), `apply-proposal-after-${Date.now()}.txt`);
  fs.writeFileSync(afterTmp, newContent, "utf-8");
  const r = spawnSync("git", ["diff", "--no-index", "--", before, afterTmp], {
    cwd,
    encoding: "utf-8",
  });
  fs.rmSync(afterTmp, { force: true });
  let diff = r.stdout || "";
  const relBefore = targetFile.replace(/\\/g, "/");
  // En Windows, `git diff --no-index` cita las rutas ("--- "a/C:\...")
  // porque contienen backslashes — no arrancan con "--- a/" literal. Se
  // matchea por el prefijo laxo ("--- ", "+++ ") igual que hace
  // computeDiffForProposal en improvements.ts, no por el prefijo exacto.
  diff = diff
    .split("\n")
    .map((line) => {
      if (line.startsWith("diff --git ")) return `diff --git a/${relBefore} b/${relBefore}`;
      if (line.startsWith("--- ")) return `--- a/${relBefore}`;
      if (line.startsWith("+++ ")) return `+++ b/${relBefore}`;
      return line;
    })
    .join("\n");
  return diff;
}

function writeProposalsJson(cwd: string, proposals: Proposal[]) {
  const dir = path.join(cwd, "proposals");
  fs.mkdirSync(dir, { recursive: true });
  // findLatestProposalsJson() lee cwd/proposals/*.json (el ultimo por orden
  // alfabetico) y espera { proposals: [...] }, no un array suelto.
  fs.writeFileSync(
    path.join(dir, "latest.json"),
    JSON.stringify({ proposals }, null, 2),
    "utf-8",
  );
}

describe("applyProposal - F2.14 integration on temp git repo", () => {
  let repo: string;
  let originalCwd: string;
  const TARGET_FILE = "src/example.txt";

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "shinobi-apply-proposal-"));
    originalCwd = process.cwd();
    git(["init", "-q"], repo);
    git(["config", "user.email", "t@t.local"], repo);
    git(["config", "user.name", "T"], repo);
    git(["config", "commit.gpgsign", "false"], repo);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, TARGET_FILE), "line1\nline2\nline3\n", "utf-8");
    git(["add", "-A"], repo);
    git(["commit", "-q", "-m", "init"], repo);
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
  });

  it("aplica un diff valido correctamente", async () => {
    const diff = buildValidDiff(repo, TARGET_FILE, "line1\nline2-MODIFICADA\nline3\n");
    const proposal: Proposal = {
      id: "prop-valid-1",
      file: TARGET_FILE,
      motive: "cambio valido",
      risk: "low",
      diff,
    };
    writeProposalsJson(repo, [proposal]);

    const asker = async (_q: string) => "y";
    const result = await applyProposal("prop-valid-1", asker);

    expect(result.ok).toBe(true);
    const content = fs.readFileSync(path.join(repo, TARGET_FILE), "utf-8");
    expect(content).toContain("line2-MODIFICADA");
  });

  it("rechaza un diff corrupto de forma atomica (sin estado parcial en el arbol)", async () => {
    const before = fs.readFileSync(path.join(repo, TARGET_FILE), "utf-8");
    // Hunk header que referencia lineas que no existen -> git apply debe fallar.
    const corruptDiff = [
      `diff --git a/${TARGET_FILE} b/${TARGET_FILE}`,
      `--- a/${TARGET_FILE}`,
      `+++ b/${TARGET_FILE}`,
      "@@ -100,3 +100,3 @@",
      " lineNoExiste1",
      "-lineNoExiste2",
      "+lineNoExisteModificada",
      " lineNoExiste3",
      "",
    ].join("\n");

    const proposal: Proposal = {
      id: "prop-corrupt-1",
      file: TARGET_FILE,
      motive: "diff corrupto",
      risk: "low",
      diff: corruptDiff,
    };
    writeProposalsJson(repo, [proposal]);

    const asker = async (_q: string) => "y";
    const result = await applyProposal("prop-corrupt-1", asker);

    expect(result.ok).toBe(false);

    const after = fs.readFileSync(path.join(repo, TARGET_FILE), "utf-8");
    expect(after).toBe(before);

    const status = git(["status", "--porcelain"], repo).stdout;
    const relevantLines = status
      .split("\n")
      .filter((l) => l.trim().length > 0 && !l.includes("proposals/"));
    expect(relevantLines.join("\n")).toBe("");
  });

  it("NUNCA hace commit automatico al aplicar (invariante existente, no debilitado)", async () => {
    const before = commitCount(repo);
    const diff = buildValidDiff(repo, TARGET_FILE, "line1\nline2\nline3-CAMBIADA\n");
    const proposal: Proposal = {
      id: "prop-no-commit-1",
      file: TARGET_FILE,
      motive: "no debe commitear",
      risk: "low",
      diff,
    };
    writeProposalsJson(repo, [proposal]);

    const asker = async (_q: string) => "y";
    const result = await applyProposal("prop-no-commit-1", asker);

    expect(result.ok).toBe(true);
    const after = commitCount(repo);
    expect(after).toBe(before);

    const status = git(["status", "--porcelain"], repo).stdout;
    expect(status).toMatch(new RegExp(`M\\s+${TARGET_FILE.replace(/\//g, "\\/")}`));
  });

  it("devuelve error claro si el id de propuesta no existe", async () => {
    writeProposalsJson(repo, []);
    const asker = async (_q: string) => "y";
    const result = await applyProposal("prop-no-existe", asker);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });

  it("si el usuario responde 'no' al asker, aborta sin cambios", async () => {
    const before = fs.readFileSync(path.join(repo, TARGET_FILE), "utf-8");
    const diff = buildValidDiff(repo, TARGET_FILE, "line1\nline2\nline3-RECHAZADA\n");
    const proposal: Proposal = {
      id: "prop-declined-1",
      file: TARGET_FILE,
      motive: "rechazada por el usuario",
      risk: "low",
      diff,
    };
    writeProposalsJson(repo, [proposal]);

    const asker = async (_q: string) => "n";
    const result = await applyProposal("prop-declined-1", asker);

    expect(result.ok).toBe(false);
    const after = fs.readFileSync(path.join(repo, TARGET_FILE), "utf-8");
    expect(after).toBe(before);
  });
});
