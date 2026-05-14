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
import './clean_extract.js';
import './generate_document.js';
import './n8n_invoke.js';
import './n8n_list_catalog.js';
import './skill_list.js';
import './skill_request_generation.js';
import './screen_observe.js';
import './screen_act.js';

// Windows-elite tool pack (Tier S #5): expone capacidades nativas que
// agentes cross-platform (Hermes, OpenClaw) no pueden cubrir bien.
import './clipboard_read.js';
import './clipboard_write.js';
import './process_list.js';
import './system_info.js';
import './disk_usage.js';
import './env_list.js';
import './network_info.js';
import './registry_read.js';
import './task_scheduler_create.js';
import './windows_notification.js';
import './voice_speak.js';
import './audio_transcribe.js';

import { getAllTools, getTool, toOpenAITools } from './tool_registry.js';

export { getAllTools, getTool, toOpenAITools };
