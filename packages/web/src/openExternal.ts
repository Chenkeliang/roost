// Open an external URL in the system browser. In a normal browser, window.open;
// inside Tauri (where window.open / <a target=_blank> are no-ops in the webview),
// use the opener plugin.
export async function openExternal(href: string): Promise<void> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(href);
    return;
  }
  window.open(href, "_blank", "noopener");
}
