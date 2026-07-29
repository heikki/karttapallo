import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const { BrowserView, BrowserWindow, ApplicationMenu, Utils } =
  await import('electrobun/bun');

const { createAlbumStore } = await import('./album-store');
const { createApiHandler } = await import('./api-routes');
const { openItemStore } = await import('./item-store');
const { createOrsClient } = await import('./ors-client');
const {
  createImageCache,
  openPhotosLibrary,
  resolveLibrary,
  libraryDataDir,
  markLibraryDir
} = await import('./photos-library');
const { createPhotosWriter } = await import('./photos-edit');
const { createRequestHandler } = await import('./request-handler');
const { getSetting, setSetting } = await import('./state');

// Detect dev build from version.json
const resourcesDir = resolve(dirname(process.argv0), '..', 'Resources');
let isDev = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Bun.file().json() returns any
  const versionInfo: { channel?: string } = await Bun.file(
    join(resourcesDir, 'version.json')
  ).json();
  isDev = versionInfo.channel === 'dev';
} catch {
  // ignore
}

function findProjectRoot(): string | null {
  if (isDev) {
    const root = resolve(resourcesDir, '..', '..', '..', '..', '..');
    if (existsSync(join(root, 'src', 'server'))) return root;
  }
  return null;
}

const projectRoot = findProjectRoot();

function findDataDir(): string {
  if (
    process.env.KARTTAPALLO_DATA_DIR !== undefined &&
    process.env.KARTTAPALLO_DATA_DIR !== ''
  ) {
    return resolve(process.env.KARTTAPALLO_DATA_DIR);
  }

  if (projectRoot !== null) {
    const dataPath = join(projectRoot, '.data');
    if (existsSync(dataPath)) {
      return dataPath;
    }
  }

  return join(process.env.HOME!, 'Library/Application Support/Karttapallo');
}

const dataDir = findDataDir();
console.log(`[main] Data directory: ${dataDir}`);

mkdirSync(dataDir, { recursive: true });

// Deep link to the Full Disk Access list. Must be the System Settings anchor:
// the pre-Ventura `com.apple.preference.security?Privacy_AllFiles` form is not
// reliably remapped and can land on the Privacy root with no FDA list in sight.
const FDA_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles';

// Full Disk Access is cached per process: an app that was already running when
// the grant was ticked does not see it — macOS itself offers "Quit & Reopen"
// for this. So recovery has to relaunch; retrying in-process can only ever fail
// again, leaving the user stuck in the modal.
function relaunchApp(): never {
  // process.argv0 is <bundle>/Contents/MacOS/launcher (same base as resourcesDir).
  const appBundle = resolve(dirname(process.argv0), '..', '..');
  Bun.spawn(['open', '-n', appBundle], {
    stdio: ['ignore', 'ignore', 'ignore']
  });
  process.exit(0);
}

// Resolve the active Photos library, failing loud (ADR 0012). Never silently
// fall back to a different library — show the user why and let them recover.
async function resolveLibraryOrExit(): Promise<string> {
  for (;;) {
    const r = resolveLibrary();
    if (r.ok) return r.path;

    if (r.error === 'fda') {
      // eslint-disable-next-line no-await-in-loop -- modal retry loop is inherently sequential
      const { response } = await Utils.showMessageBox({
        type: 'warning',
        title: 'Full Disk Access Required',
        // Text goes in `message`, never `detail`: Electrobun forwards `detail`
        // over FFI but its prebuilt native binary drops it — NSAlert has only
        // messageText/informativeText, spent on `title` and `message`.
        message:
          'Karttapallo needs Full Disk Access to find your Photos library.\n\n' +
          'Switch it on in the list, then open Karttapallo again.',
        buttons: ['Open System Settings', 'Quit']
      });
      // Quit either way. The grant cannot reach this process, so there is
      // nothing left for it to do — and staying alive would re-show this modal
      // on top of the Settings window the user just asked for. spawnSync so the
      // exit below can't tear `open` down with us.
      if (response === 0) Bun.spawnSync(['open', FDA_SETTINGS_URL]);
      process.exit(response === 0 ? 0 : 1);
    } else {
      const where =
        r.volume === null ? 'at its saved path' : `on the volume "${r.volume}"`;
      // eslint-disable-next-line no-await-in-loop -- modal retry loop is inherently sequential
      const { response } = await Utils.showMessageBox({
        type: 'warning',
        title: 'Photos Library Unavailable',
        message: `Your Photos library isn't available — it lives ${where}.`,
        detail: `${r.libraryPath}\n\nConnect the drive, then click Retry.`,
        buttons: ['Retry', 'Quit']
      });
      if (response === 1) process.exit(1);
    }
  }
}

const libraryPath = await resolveLibraryOrExit();
const libDir = libraryDataDir(dataDir, libraryPath);
mkdirSync(libDir, { recursive: true });
markLibraryDir(libDir, libraryPath);
console.log(`[main] Library: ${libraryPath}`);
console.log(`[main] Library data: ${libDir}`);

const imageCache = createImageCache({
  cacheDir: join(libDir, 'cache'),
  libraryPath
});
const photosLibrary = openPhotosLibrary({ imageCache, libraryPath });
const itemStore = openItemStore({
  dataDir: libDir,
  imageCache,
  libraryPath,
  photosWriter: createPhotosWriter(libraryPath)
});
const albumStore = createAlbumStore(libDir);
const orsClient = createOrsClient(dataDir);
const { routeApiRequest } = createApiHandler(libDir, {
  itemStore,
  photosLibrary,
  albumStore,
  orsClient
});

// Locate bundled view files
const appDir = join(resourcesDir, 'app');
const viewsDir = join(appDir, 'views', 'app');

// App menu
ApplicationMenu.setApplicationMenu([
  {
    label: 'Karttapallo',
    submenu: [
      { label: 'About Karttapallo', action: 'about' },
      { type: 'divider' },
      { role: 'hide', accelerator: 'CmdOrCtrl+H' },
      { role: 'hideOthers', accelerator: 'Alt+CmdOrCtrl+H' },
      { role: 'showAll' },
      { type: 'divider' },
      {
        label: 'Quit Karttapallo',
        action: 'quit',
        accelerator: 'CmdOrCtrl+Q'
      }
    ]
  },
  {
    label: 'Photos',
    submenu: [
      { label: 'Sync Photos', action: 'resync' },
      { label: 'Clear Cache', action: 'clear-cache' }
    ]
  },
  {
    label: 'Window',
    submenu: [
      { role: 'minimize', accelerator: 'CmdOrCtrl+M' },
      { role: 'close', accelerator: 'CmdOrCtrl+W' }
    ]
  }
]);

// Full Disk Access dialog — shown once per session when Photos.sqlite can't be read
let fullDiskAccessShown = false;
function showFullDiskAccessDialog() {
  if (fullDiskAccessShown) return;
  fullDiskAccessShown = true;
  void Utils.showMessageBox({
    type: 'warning',
    title: 'Full Disk Access Required',
    // See the note in resolveLibraryOrExit: `detail` is never rendered.
    message:
      'Karttapallo needs Full Disk Access to read photo metadata.\n\n' +
      'Switch it on in the list, then relaunch.',
    buttons: ['Open System Settings', 'Relaunch', 'OK']
  }).then(({ response }: { response: number }) => {
    if (response === 0) {
      Bun.spawn(['open', FDA_SETTINGS_URL]);
    } else if (response === 1) {
      relaunchApp();
    }
  });
}

async function checkFullDiskAccess(response: Response, pathname: string) {
  if (response.status === 500 && pathname.startsWith('/api/metadata/')) {
    const body = await response.clone().text();
    if (
      body.includes('CANTOPEN') ||
      body.includes('unable to open') ||
      body.includes('not found')
    ) {
      showFullDiskAccessDialog();
    }
  }
}

const fetch = createRequestHandler({
  routeApi: routeApiRequest,
  staticRoots: [viewsDir, libDir],
  onResponse: async (req, res, pathname) => {
    if (pathname.startsWith('/api/')) {
      await checkFullDiskAccess(res, pathname);
    }
  }
});

// Start local server that serves both API and view files
const server = Bun.serve({ port: 0, fetch });

const baseUrl = `http://127.0.0.1:${server.port}`;
console.log(`[main] Server running on ${baseUrl}`);

const defaultFrame = { x: 100, y: 100, width: 1200, height: 800 };

function loadWindowState(): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  try {
    const raw = getSetting(dataDir, 'window');
    if (raw === null) return defaultFrame;
    return JSON.parse(raw) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  } catch {
    return defaultFrame;
  }
}

function saveWindowState(frame: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  setSetting(dataDir, 'window', JSON.stringify(frame));
}

// RPC type definition for Electrobun communication
interface AppRPC {
  bun: {
    requests: Record<string, never>;
    messages: Record<string, never>;
  };
  webview: {
    requests: Record<string, never>;
    messages: Record<string, never>;
  };
}

// Create browser window
const rpc = BrowserView.defineRPC<AppRPC>({
  handlers: {
    requests: {},
    messages: {}
  }
});

const savedFrame = loadWindowState();

function buildViewUrl(): string {
  try {
    // `view` is per-library (it carries library-specific state — map center,
    // filters, and the selected photo UUID), so it lives in libDir, not the
    // global state.json that holds `window`.
    const raw = getSetting(libDir, 'view');
    if (raw === null) return baseUrl;
    const obj = JSON.parse(raw) as Record<string, string>;
    const qs = new URLSearchParams(obj).toString();
    return qs === '' ? baseUrl : `${baseUrl}?${qs}`;
  } catch {
    return baseUrl;
  }
}

// Create the webview already pointing at the app URL. Electrobun passes the
// constructor `url` to the native webview at creation (see BrowserView.init),
// so this is race-free. Do NOT switch back to `about:blank` + a later
// `win.webview.loadURL()` — that second load races webview creation and gets
// dropped (window stays blank) unless something happens to yield a tick first.
const win = new BrowserWindow<typeof rpc>({
  title: 'Karttapallo',
  url: buildViewUrl(),
  frame: savedFrame,
  rpc
});

// Save window state on move/resize
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSave() {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const frame = win.getFrame();
    saveWindowState(frame);
  }, 500);
}

win.on('move', debouncedSave);
win.on('resize', debouncedSave);

// Open external links (target="_blank", window.open) in system browser
function openInSystem(url: string) {
  if (url !== '' && !url.startsWith(baseUrl)) {
    console.log(`[main] Opening external: ${url}`);
    Bun.spawn(['open', url]);
  }
}

interface ElectrobunEvent {
  data?: { detail?: string | { url?: string }; action?: string };
}

function extractUrl(event: ElectrobunEvent): string {
  const detail = event.data?.detail;
  if (typeof detail === 'string') {
    if (detail.startsWith('{')) {
      try {
        const parsed = JSON.parse(detail) as {
          url?: string;
          allowed?: boolean;
        };
        // allowed=true means electrobun will navigate the webview internally;
        // we have nothing to open in the system browser.
        if (parsed.allowed === true) return '';
        return parsed.url ?? '';
      } catch {
        /* fall through to raw string */
      }
    }
    return detail;
  }
  if (detail !== undefined && typeof detail.url === 'string') return detail.url;
  return '';
}

win.webview.on('will-navigate', (event: unknown) => {
  const url = extractUrl(event as ElectrobunEvent);
  if (url !== '' && !url.startsWith(baseUrl)) {
    openInSystem(url);
  }
});
// @ts-expect-error -- new-window-open not in BrowserView.on() types
win.webview.on('new-window-open', (event: unknown) => {
  openInSystem(extractUrl(event as ElectrobunEvent));
});

// In-process Photos sync (manual "Sync Photos" menu action)
let syncing = false;
async function syncPhotos() {
  if (syncing) {
    void Utils.showMessageBox({
      type: 'warning',
      title: 'Sync Running',
      message: 'A sync is already in progress. Please wait.',
      buttons: ['OK']
    });
    return;
  }
  syncing = true;
  win.setTitle('Karttapallo — Syncing…');
  try {
    const changed = await itemStore.rebuild();
    if (changed) win.webview.loadURL(buildViewUrl());
    void Utils.showMessageBox({
      type: 'info',
      title: 'Sync Complete',
      message: changed
        ? 'Sync complete — items updated.'
        : 'Sync complete — no changes.',
      buttons: ['OK']
    });
  } catch (err) {
    void Utils.showMessageBox({
      type: 'error',
      title: 'Sync Failed',
      message: err instanceof Error ? err.message : String(err),
      buttons: ['OK']
    });
  } finally {
    syncing = false; // eslint-disable-line require-atomic-updates -- intentional sequential reset
    win.setTitle('Karttapallo');
  }
}

/** Delete cached images and reload webview. */
function clearCache() {
  const cacheFullDir = join(libDir, 'cache', 'full');
  const cacheThumbDir = join(libDir, 'cache', 'thumb');

  if (existsSync(cacheFullDir)) rmSync(cacheFullDir, { recursive: true });
  if (existsSync(cacheThumbDir)) rmSync(cacheThumbDir, { recursive: true });

  mkdirSync(cacheFullDir, { recursive: true });
  mkdirSync(cacheThumbDir, { recursive: true });

  console.log('[main] Cache cleared');
  win.webview.loadURL(buildViewUrl());
  void Utils.showMessageBox({
    type: 'info',
    title: 'Cache Cleared',
    message:
      'Image cache has been cleared. Images will be re-cached on demand.',
    buttons: ['OK']
  });
}

// Handle menu actions. Electrobun delivers the action under `event.data`,
// not the standard CustomEvent `event.detail` shape — easy to get wrong.
ApplicationMenu.on('application-menu-clicked', (event: unknown) => {
  const action = (event as ElectrobunEvent).data?.action ?? '';
  switch (action) {
    case 'quit':
      process.exit(0);
      break;
    case 'resync':
      void syncPhotos();
      break;
    case 'clear-cache':
      clearCache();
      break;
  }
});

// The webview already loaded the snapshot view at construction (above). Reload
// only if the post-startup rebuild detected actual changes. The change
// detection skips the reload when the snapshot already matched fresh data —
// keeps cold starts flicker-free in the common case. By now the webview is
// fully initialized, so this later loadURL is safe.
itemStore.rebuildComplete
  .then((changed) => {
    if (changed) win.webview.loadURL(buildViewUrl());
    console.log(
      changed
        ? '[main] Rebuild complete — items changed, webview reloaded'
        : '[main] Rebuild complete — no changes'
    );
  })
  .catch((err: unknown) => {
    console.log(
      '[main] Initial rebuild failed:',
      err instanceof Error ? err.message : String(err)
    );
  });
