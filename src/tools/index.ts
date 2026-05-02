// src/tools/index.ts
// Este archivo fuerza la carga y registro de todas las herramientas nativas.
import './read_file.js';
import './write_file.js';
import './edit_file.js';
import './run_command.js';
import './list_dir.js';
import './search_files.js';
import './web_search.js';
import './browser_click.js';
import './browser_scroll.js';
import './browser_click_position.js';
import './cloud_mission.js'; // The new tool to bridge with OpenGravity Cloud
import './web_search_with_warmup.js';

import { getAllTools, getTool, toOpenAITools } from './tool_registry.js';

export { getAllTools, getTool, toOpenAITools };
