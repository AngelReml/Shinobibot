// src/tools/index.ts
// Este archivo fuerza la carga y registro de todas las herramientas nativas.
import './read_file.js';
import './write_file.js';
import './edit_file.js';
import './run_command.js';
import './list_dir.js';
import './search_files.js';
import './web_search.js';
import './kernel_mission.js'; // The new tool to bridge with OpenGravity Kernel

import { getAllTools, getTool, toOpenAITools } from './tool_registry.js';

export { getAllTools, getTool, toOpenAITools };
