import * as data from '@common/data';
import * as edits from '@common/edits';

/**
 * Surface a message both as an alert and in the Shift+D debug log. WKWebView
 * only shows `alert()` if the host wires up the JS-dialog delegate; routing to
 * the debug log too means save failures are visible even if it doesn't.
 */
function notifyUser(msg: string) {
  const log = (window as unknown as { __debugLog?: string[] }).__debugLog;
  log?.push(`${new Date().toISOString().slice(11, 19)} SAVE: ${msg}`);
  // eslint-disable-next-line no-alert -- user needs feedback on save failure
  alert(msg);
}

export async function saveEdits() {
  const coordEdits = edits.getCoordEdits();
  const timeEdits = edits.getTimeEdits();
  if (coordEdits.length === 0 && timeEdits.length === 0) return;

  edits.saving.set(true);

  try {
    const response = await fetch('/api/save-edits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edits: coordEdits, timeEdits })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text);
    }
    const body = (await response.json()) as {
      ok: boolean;
      failures?: Array<{ uuid: string; error?: string }>;
    };
    await data.loadPhotos();
    edits.clear();
    if (body.failures !== undefined && body.failures.length > 0) {
      const messages = [
        ...new Set(body.failures.map((f) => f.error ?? 'unknown error'))
      ].join('\n');
      notifyUser(
        `${body.failures.length} edit(s) could not be saved to Photos:\n\n${messages}`
      );
    }
  } catch (err) {
    console.error('Failed to save edits:', err);
    notifyUser(
      `Failed to save edits: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    edits.saving.set(false);
  }
}
