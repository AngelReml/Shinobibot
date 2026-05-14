/**
 * Windows Notification — toast nativo Windows 10+ vía la API
 * `Windows.UI.Notifications.ToastNotificationManager`. Se invoca desde
 * PowerShell con un XML de toast generado a partir del título y cuerpo
 * sanitizados.
 *
 * No requiere instalar `BurntToast` ni ningún módulo externo: la
 * WindowsRuntime está disponible por defecto desde Windows 10.
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { runPowerShell, psLit } from './_powershell.js';

function sanitizeXmlText(s: string): string {
  // XML escape mínimo para inyectar en el template.
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const tool: Tool = {
  name: 'windows_notification',
  description: 'Show a native Windows 10+ toast notification with a title and body. Useful to alert the user about completed long-running tasks. Does not require external modules.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Toast title (short, < 60 chars recommended).' },
      body: { type: 'string', description: 'Toast body text.' },
      appId: { type: 'string', description: 'Optional: AUMID app id. Defaults to "Shinobi".' },
    },
    required: ['title', 'body'],
  },

  async execute(args: { title: string; body: string; appId?: string }): Promise<ToolResult> {
    const titleXml = sanitizeXmlText(args.title);
    const bodyXml = sanitizeXmlText(args.body);
    const appId = (args.appId && /^[\w.\-]{1,64}$/.test(args.appId)) ? args.appId : 'Shinobi';

    const toastXml =
      `<toast><visual><binding template='ToastGeneric'>` +
      `<text>${titleXml}</text><text>${bodyXml}</text>` +
      `</binding></visual></toast>`;

    // Construimos un script PS que carga la API WinRT y dispara el toast.
    const script =
      `[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null; ` +
      `[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime] | Out-Null; ` +
      `$xml = New-Object Windows.Data.Xml.Dom.XmlDocument; ` +
      `$xml.LoadXml(${psLit(toastXml)}); ` +
      `$toast = [Windows.UI.Notifications.ToastNotification]::new($xml); ` +
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${psLit(appId)}).Show($toast)`;

    const r = await runPowerShell(script);
    if (!r.success) {
      return { success: false, output: '', error: r.stderr.trim() || `PowerShell exited ${r.exitCode}` };
    }
    return { success: true, output: `Toast mostrada (appId=${appId}).` };
  },
};

registerTool(tool);
export default tool;
export { sanitizeXmlText };
