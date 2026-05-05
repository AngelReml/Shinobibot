# A.4 — Validación de Habilidad A en repos reales

Estado: **PENDIENTE — requiere ejecución humana**.

Gate (plan v1.0 §3.4):
- Ratio aciertos ≥ 80% en cada repo.
- Cero hallucinations graves (afirmaciones de código que no existe).
- Documento commiteado con outputs crudos.

---

## Pre-requisitos

- [ ] `OPENROUTER_API_KEY` exportada en `.env`.
- [ ] Tener clonado localmente OpenGravity en una ruta absoluta conocida.
- [ ] Elegir un repo random de GitHub mediano (≤ 5k archivos source) y clonarlo.

## Procedimiento por repo

```
shinobi
> /read <ruta_absoluta>
```

Esto persiste:
- `missions/<timestamp>_read/report.json`
- `missions/<timestamp>_read/subreports.json`
- `missions/<timestamp>_read/meta.json`

Pega `report.json` debajo del bloque correspondiente y, en la tabla de afirmaciones, marca cada bullet con `C` (correcta) / `I` (incorrecta) / `R` (irrelevante).

---

## Repo 1 — OpenGravity

- Ruta: `_____`
- Mission dir: `_____`
- Duración: `_____ s`
- Sub-agents: `_____`

### Afirmaciones evaluadas

| # | Afirmación (extracto del report) | Veredicto | Comentario |
|---|---|---|---|
| 1 | _____ | C / I / R | _____ |
| 2 | _____ | C / I / R | _____ |
| … | | | |

**Ratio**: `<C> / (<C>+<I>) = ___%` (irrelevantes excluidas del denominador).
**Hallucinations graves**: `___` (≥1 = gate FALLA).

---

## Repo 2 — Repo random de GitHub

- URL origen: `_____`
- Ruta local: `_____`
- Mission dir: `_____`
- Duración: `_____ s`

### Afirmaciones evaluadas

| # | Afirmación | Veredicto | Comentario |
|---|---|---|---|
| 1 | _____ | C / I / R | _____ |

**Ratio**: `___%`.
**Hallucinations graves**: `___`.

---

## Veredicto final

- [ ] Repo 1: ratio ≥ 80% **y** 0 hallucinations graves.
- [ ] Repo 2: ratio ≥ 80% **y** 0 hallucinations graves.

Si ambos tachados → A.4 **VERDE**. Anotar fecha y commit a este archivo:

```
A.4 cerrada el _____ — gate VERDE — Habilidad A COMPLETA.
```

Si alguno falla → A.4 **ROJO**. Análisis de causa raíz aquí abajo y volver a A.2/A.3 según corresponda. **No** avanzar a Habilidad B.


---

## RAW DUMPS — ejecutado 2026-05-05T21:28:46.450Z

> Reports crudos volcados por scripts/a4_run.ts. Pendiente evaluación humana C/I/R.

### Repo: OpenGravity
- mission_dir: `C:\Users\angel\Desktop\shinobibot\missions\2026-05-05T21-28-21-708Z_a4_opengravity`
- duration_ms: 25248
- ok: true

#### report.json

```json
{
  "repo_purpose": "OpenGravity is an experimental autonomous agent system designed for mission planning and strategy execution using LLMs.",
  "architecture_summary": "OpenGravity comprises multiple modules and folders, each serving distinct purposes. At the core, key files like `package.json` and `tsconfig.json` manage dependencies and TypeScript configurations, respectively. The `.tmp.driveupload` directory functions as a temporary storage area for service upload states but poses a risk of data corruption. The `backups/snap_003` folder holds backup files, including performance metrics and a system-generated report. A Python virtual environment setup is located in `benchmark_venv`, containing scripts for environment management. The `data` directory manages JSON files related to system agent statistics, where mutation tracking is evident but many failures are reported without successes. The `datasets/consolidate.py` script processes raw JSON dataset files into a CSV format with hash verifications; however, its lack of tests and reliance on hardcoded paths are concerns. While the project is rich in data handling, documentation and testing mechanisms are critically few, leading to risks in data accuracy and system stability.",
  "modules": [
    {
      "name": "Main Project Files",
      "path": "/",
      "responsibility": "Hold metadata, dependencies, and configurations for the project."
    },
    {
      "name": "Temporary Upload States",
      "path": ".tmp.driveupload",
      "responsibility": "Temporary storage for various service upload states."
    },
    {
      "name": "Backup Files",
      "path": "backups/snap_003",
      "responsibility": "Contain backups, including configuration and performance files."
    },
    {
      "name": "Python Virtual Environment",
      "path": "benchmark_venv",
      "responsibility": "Scripts and configurations for managing Python environment."
    },
    {
      "name": "Agent Mutation Data",
      "path": "data",
      "responsibility": "Store evolution statistics and mutation records for system agents."
    },
    {
      "name": "Data Consolidation Script",
      "path": "datasets/consolidate.py",
      "responsibility": "Processes JSON data into consolidated CSV format with hash verification."
    }
  ],
  "entry_points": [
    {
      "file": "package.json",
      "kind": "project metadata"
    },
    {
      "file": "tsconfig.json",
      "kind": "TypeScript configuration"
    },
    {
      "file": "consolidate.py",
      "kind": "data processing script"
    }
  ],
  "risks": [
    {
      "severity": "medium",
      "description": "Project is in beta stage with potential lack of complete testing frameworks as per README."
    },
    {
      "severity": "high",
      "description": "Potential data corruption in `.tmp.driveupload` due to unresolved issues with binary files."
    },
    {
      "severity": "medium",
      "description": "Mutation data indicates high failure rates without successes which suggests underlying operational issues."
    },
    {
      "severity": "medium",
      "description": "Hardcoded paths in `consolidate.py` could lead to functional issues if the structure changes."
    },
    {
      "severity": "medium",
      "description": "`data/memory.db` is present but currently inaccessible; content unknown."
    },
    {
      "severity": "medium",
      "description": "Mention of [unreadable] due to often cryptic and incomplete documentation across modules and setups."
    }
  ],
  "evidence": {
    "subagent_count": 6,
    "tokens_total": 0,
    "duration_ms": 18285,
    "subreports_referenced": 6
  }
}
```

#### subreports.json

```json
[
  {
    "path": "/",
    "purpose": "OpenGravity is an experimental autonomous agent system designed for mission planning and strategy execution using LLMs.",
    "key_files": [
      {
        "name": "package.json",
        "role": "Defines project metadata, dependencies, and scripts for development and build."
      },
      {
        "name": "README.md",
        "role": "Provides an overview of the project, setup instructions, and architectural components."
      },
      {
        "name": "tsconfig.json",
        "role": "Configures TypeScript compiler options for the project."
      }
    ],
    "dependencies": {
      "internal": [],
      "external": [
        "@babel/runtime",
        "@modelcontextprotocol/server-filesystem",
        "@types/cors",
        "@types/express",
        "ajv",
        "ajv-formats",
        "axios",
        "better-sqlite3",
        "cors",
        "cowsay",
        "dotenv",
        "express",
        "grammy",
        "groq-sdk",
        "hnswlib-node",
        "html-to-docx",
        "jsonfile",
        "marked",
        "playwright",
        "random-words"
      ]
    },
    "concerns": [
      "Project is in beta/research stage, indicating ongoing development.",
      "No explicit mention of testing framework or coverage in README.",
      "Installation instructions are incomplete in terms of npm package installation.",
      "No clear examples or usage documentation provided in README.",
      "Potential lack of extensive tests based on README content."
    ]
  },
  {
    "path": ".tmp.driveupload",
    "purpose": "Temporary folder for storing upload configuration states for various services.",
    "key_files": [
      {
        "name": "13430",
        "role": "Upload state for ollama, n8n, groq, and genesis services."
      },
      {
        "name": "27073",
        "role": "Initialization state for lmstudio, n8n, groq, and genesis services."
      }
    ],
    "dependencies": {
      "internal": [],
      "external": []
    },
    "concerns": [
      "Contains files with potentially corrupted or binary data (files 27455, 27457, 27461).",
      "No clear documentation or structure for file contents and purpose.",
      "Temporary nature implies potential data loss if not handled properly."
    ]
  },
  {
    "path": "backups/snap_003",
    "purpose": "Backup folder containing various files related to the opengravity project, including configuration and metrics.",
    "key_files": [
      {
        "name": "package.json",
        "role": "Defines project dependencies and scripts."
      },
      {
        "name": "tsconfig.json",
        "role": "Specifies TypeScript compiler options."
      },
      {
        "name": "latency_metrics.json",
        "role": "Stores performance metrics of the system."
      },
      {
        "name": "REPORTE_DIARIO.md",
        "role": "Markdown report generated by the system."
      },
      {
        "name": "test.txt",
        "role": "Text file with a greeting message."
      }
    ],
    "dependencies": {
      "internal": [],
      "external": [
        "@types/express",
        "better-sqlite3",
        "cowsay",
        "dotenv",
        "express",
        "grammy",
        "groq-sdk",
        "html-to-docx",
        "marked",
        "playwright",
        "random-words",
        "hnswlib-node"
      ]
    },
    "concerns": []
  },
  {
    "path": "benchmark_venv",
    "purpose": "This folder contains scripts and configurations for setting up and managing a Python virtual environment.",
    "key_files": [
      {
        "name": "pyvenv.cfg",
        "role": "Configuration file for the Python virtual environment"
      },
      {
        "name": "Scripts/activate",
        "role": "Script to activate the Python virtual environment in bash"
      },
      {
        "name": "Scripts/activate.bat",
        "role": "Script to activate the Python virtual environment in Windows Command Prompt"
      },
      {
        "name": "Scripts/Activate.ps1",
        "role": "Script to activate the Python virtual environment in PowerShell"
      },
      {
        "name": "Scripts/deactivate.bat",
        "role": "Script to deactivate the Python virtual environment in Windows Command Prompt"
      }
    ],
    "dependencies": {
      "internal": [],
      "external": []
    },
    "concerns": []
  },
  {
    "path": "data",
    "purpose": "Store JSON files related to evolution statistics and approved mutations for system agents.",
    "key_files": [
      {
        "name": "evolution_stats.json",
        "role": "Tracks success rates of proposed mutations"
      },
      {
        "name": "mutations_approved.json",
        "role": "Lists approved mutations and their reasons"
      },
      {
        "name": "mutation_candidates.json",
        "role": "Defines candidates for future mutations"
      },
      {
        "name": "mutation_candidates_filtered.json",
        "role": "Filtered list of mutation candidates based on certain criteria"
      }
    ],
    "dependencies": {
      "internal": [],
      "external": []
    },
    "concerns": [
      "evolution_stats.json indicates multiple mutation failures with no successes.",
      "memory.db file is present but inaccessible to determine its contents.",
      "No tests or validation mechanisms noted in the JSON files.",
      "mutation_candidates.json is truncated, limiting the data scope.",
      "No structures in place to manage the large number of mutation records efficiently."
    ]
  },
  {
    "path": "datasets/consolidate.py",
    "purpose": "Consolidates JSON data from raw datasets into a CSV report with hash verification.",
    "key_files": [
      {
        "name": "ledger.jsonl",
        "role": "provides execution hash details"
      },
      {
        "name": "reports/consolidated_run_20260421_17.csv",
        "role": "final output report"
      }
    ],
    "dependencies": {
      "internal": [
        "datasets/INCIDENT_20260427.md"
      ],
      "external": []
    },
    "concerns": [
      "TODO comments present for potential improvements.",
      "No tests found for script functionality.",
      "Hardcoded paths can lead to issues in different environments.",
      "Raw directory access could cause errors if the path changes.",
      "CSV output assumes a specific data structure in JSON files."
    ]
  }
]
```

### Repo: execa
- mission_dir: `C:\Users\angel\Desktop\shinobibot\missions\2026-05-05T21-28-46-431Z_a4_execa`
- duration_ms: 24705
- ok: true

#### report.json

```json
{
  "repo_purpose": "A module for process execution optimized for programmatic use, featuring a simple syntax, built-in error handling, and support for local binaries.",
  "architecture_summary": "This project is structured to handle process execution with configurable verbosity and logging options. It includes modules for managing subprocesses, type definitions for structuring communications between these processes, and comprehensive testing for various functionalities. The main entry point manages project metadata and dependencies, while a separate directory handles logging and verbose outputs. Multiple test suites ensure functionality across different scenarios, though some edge cases remain untested. The project also provides extensive documentation and configuration files for continuous integration and code coverage.",
  "modules": [
    {
      "name": "Main Module",
      "path": "/",
      "responsibility": "Manages project metadata, dependencies, and includes primary test setups."
    },
    {
      "name": "Verbose Module",
      "path": "lib/verbose",
      "responsibility": "Handles logging and verbosity options for executed commands."
    },
    {
      "name": "Type Definitions",
      "path": "types/subreport.d.ts",
      "responsibility": "Provides type definitions for subprocess communication and stream management."
    },
    {
      "name": "Test Suite",
      "path": "test/verbose",
      "responsibility": "Contains tests for verification of verbose outputs during command execution."
    },
    {
      "name": "TypeScript Tests",
      "path": "test-d",
      "responsibility": "TypeScript-based tests for subprocess management and stream handling."
    },
    {
      "name": "Miscellaneous",
      "path": "misc/",
      "responsibility": "Holds documentation, GitHub configurations, and media files for the project."
    }
  ],
  "entry_points": [
    {
      "file": "package.json",
      "kind": "Main entry for project metadata and dependencies"
    },
    {
      "file": "lib/verbose/complete.js",
      "kind": "Module logging execution results"
    },
    {
      "file": "types/subreport.d.ts",
      "kind": "Type definitions for subprocess communications"
    }
  ],
  "risks": [
    {
      "severity": "medium",
      "description": "No tests found for logging functions in 'lib/verbose', which could lead to undetected issues in verbose logging."
    },
    {
      "severity": "medium",
      "description": "Reliance on external packages could introduce vulnerabilities."
    },
    {
      "severity": "medium",
      "description": "Tests are missing for some edge cases and invalid input scenarios."
    },
    {
      "severity": "medium",
      "description": "Global variable COMMAND_ID used without isolation might cause conflicts."
    },
    {
      "severity": "medium",
      "description": "Documentation files contain dead code sections and incomplete examples."
    },
    {
      "severity": "medium",
      "description": "[unreadable] issues detected in some test cases, indicating potential gaps in coverage or execution."
    }
  ],
  "evidence": {
    "subagent_count": 6,
    "tokens_total": 0,
    "duration_ms": 11156,
    "subreports_referenced": 6
  }
}
```

#### subreports.json

```json
[
  {
    "path": "/",
    "purpose": "A process execution module optimized for programmatic use, offering a simple syntax, built-in error handling, and support for local binaries.",
    "key_files": [
      {
        "name": "package.json",
        "role": "Project metadata, dependencies, and scripts"
      },
      {
        "name": "readme.md",
        "role": "Documentation and usage examples"
      },
      {
        "name": "tsconfig.json",
        "role": "TypeScript configuration"
      }
    ],
    "dependencies": {
      "internal": [],
      "external": [
        "@sindresorhus/merge-streams",
        "cross-spawn",
        "figures",
        "get-stream",
        "human-signals",
        "is-plain-obj",
        "is-stream",
        "npm-run-path",
        "pretty-ms",
        "signal-exit",
        "strip-final-newline",
        "yoctocolors"
      ]
    },
    "concerns": [
      "No TODO comments or dead code found.",
      "Test coverage reported via Codecov.",
      "No tests found in the current files.",
      "No observed checks for potential security issues.",
      "The code relies on external packages, which may introduce vulnerabilities."
    ]
  },
  {
    "path": "test/verbose/complete.js",
    "purpose": "Contains tests for the verbose output functionality, ensuring correct command completion behavior.",
    "key_files": [
      {
        "name": "noop.js",
        "role": "subprocess for test cases"
      },
      {
        "name": "delay.js",
        "role": "subprocess for testing duration"
      },
      {
        "name": "nested-pipe-file.js",
        "role": "test fixture for piping"
      },
      {
        "name": "nested-pipe-script.js",
        "role": "test fixture for piping"
      },
      {
        "name": "nested-pipe-subprocesses.js",
        "role": "test fixture for piping"
      }
    ],
    "dependencies": {
      "internal": [
        "helpers/fixtures-directory.js",
        "helpers/input.js",
        "helpers/nested.js",
        "helpers/verbose.js"
      ],
      "external": [
        "ava",
        "node:util"
      ]
    },
    "concerns": [
      "Could benefit from additional test cases for edge scenarios.",
      "No tests verifying correct behavior for invalid inputs.",
      "All subprocess paths are assumed to exist and no validation of that is done.",
      "Code structure could be more modular to improve maintainability.",
      "Redundant tests with similar assertions could be simplified."
    ]
  },
  {
    "path": "test-d",
    "purpose": "Contains TypeScript tests for the functionality of subprocess management and stream handling using execa.",
    "key_files": [
      {
        "name": "pipe.test-d.ts",
        "role": "Tests various pipe handling scenarios with subprocesses."
      },
      {
        "name": "verbose.test-d.ts",
        "role": "Tests verbosity options for subprocess output."
      },
      {
        "name": "transform/object-mode.test-d.ts",
        "role": "Tests object-mode transformer streams in subprocess."
      },
      {
        "name": "subprocess/all.test-d.ts",
        "role": "Tests subprocess output when all streams are used."
      },
      {
        "name": "subprocess/stdio.test-d.ts",
        "role": "Tests handling of standard input/output/error streams."
      }
    ],
    "dependencies": {
      "internal": [
        "../index.js",
        "../../index.js"
      ],
      "external": [
        "tsd",
        "node:fs",
        "node:stream",
        "node:stream/web"
      ]
    },
    "concerns": [
      "TODO: Some tests may require more coverage for edge cases.",
      "Potential dead code in some test cases aiming for broader coverage.",
      "No tests on error handling scenarios for subprocess.",
      "Tests do not cover varying input types in depth.",
      "Consider revising expectations for real-world use-case scenarios."
    ]
  },
  {
    "path": "lib/verbose",
    "purpose": "Handles logging and verbosity options for commands, including error reporting and duration.",
    "key_files": [
      {
        "name": "complete.js",
        "role": "Logs command results with duration and errors."
      },
      {
        "name": "custom.js",
        "role": "Applies custom verbose functions to printed lines."
      },
      {
        "name": "default.js",
        "role": "Provides default formatting for verbose logs."
      },
      {
        "name": "error.js",
        "role": "Logs errors when commands fail."
      },
      {
        "name": "info.js",
        "role": "Collects verbose information for commands."
      }
    ],
    "dependencies": {
      "internal": [
        "./values.js",
        "./log.js",
        "./error.js"
      ],
      "external": [
        "pretty-ms",
        "figures",
        "yoctocolors"
      ]
    },
    "concerns": [
      "No direct tests found for logging functions.",
      "Missing error handling for potentially undefined verbose functions.",
      "Global variable COMMAND_ID is used without isolation, could lead to conflicts.",
      "Some utility functions like padField have no exported tests.",
      "Verbose logs may incur performance overhead if not managed properly."
    ]
  },
  {
    "path": "types/subreport.d.ts",
    "purpose": "Type definitions for SubReport handling, facilitating message passing and stream piping between subprocesses.",
    "key_files": [
      {
        "name": "convert.d.ts",
        "role": "Type definitions for Readable, Writable and Duplex options for subprocess."
      },
      {
        "name": "ipc.d.ts",
        "role": "Type definitions for IPC message handling and options."
      },
      {
        "name": "pipe.d.ts",
        "role": "Type definitions for piping between subprocesses."
      },
      {
        "name": "utils.d.ts",
        "role": "Utility type definitions for boolean operations."
      },
      {
        "name": "verbose.d.ts",
        "role": "Type definitions for verbose logging options in subprocesses."
      }
    ],
    "dependencies": {
      "internal": [
        "./arguments/options.js",
        "./arguments/fd-options.js",
        "./subprocess/subprocess.js",
        "./methods/template.js",
        "./return/result.js",
        "./arguments/specific.js"
      ],
      "external": []
    },
    "concerns": []
  },
  {
    "path": "misc/",
    "purpose": "Contains documentation, GitHub configs, and media files for the project.",
    "key_files": [
      {
        "name": "docs/api.md",
        "role": "API reference documentation for methods available in the project."
      },
      {
        "name": "docs/bash.md",
        "role": "Documentation on differences between Bash and the Execa library."
      },
      {
        "name": ".github/codecov.yml",
        "role": "Codecov configuration for reporting code coverage."
      },
      {
        "name": ".github/security.md",
        "role": "Security policy documentation for reporting vulnerabilities."
      },
      {
        "name": "media/logo.sketch",
        "role": "Design file for project logo in Sketch format."
      }
    ],
    "dependencies": {
      "internal": [],
      "external": []
    },
    "concerns": [
      "Missing tests for documentation files.",
      "Dead code sections in the documentation files with incomplete examples.",
      "Media files should be optimized for web usage."
    ]
  }
]
```
