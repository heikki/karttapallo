import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const { BrowserView, BrowserWindow, ApplicationMenu, Utils } =
  await import('electrobun/bun');

const { createAlbumStore } = await import('./album-store');
const { createApiHandler } = await import('./api-routes');
const { openItemStore } = await import('./item-store');
const { createOrsClient } = await import('./ors-client');
const { createImageCache, openPhotosLibrary } =
  await import('./photos-library');
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
const imageCache = createImageCache({ cacheDir: join(dataDir, 'cache') });
const photosLibrary = openPhotosLibrary({ imageCache });
const itemStore = openItemStore({ dataDir, imageCache });
const albumStore = createAlbumStore(dataDir);
const orsClient = createOrsClient(dataDir);
const { routeApiRequest } = createApiHandler(dataDir, {
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
    message:
      'Karttapallo needs Full Disk Access to read photo metadata from Photos.sqlite.',
    detail:
      'Open System Settings > Privacy & Security > Full Disk Access, then enable access for Karttapallo.\n\nRestart the app after granting access.',
    buttons: ['Open System Settings', 'OK']
  }).then(({ response }: { response: number }) => {
    if (response === 0) {
      Bun.spawn([
        'open',
        'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
      ]);
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
  staticRoots: [viewsDir, dataDir],
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
    const raw = getSetting(dataDir, 'view');
    if (raw === null) return baseUrl;
    const obj = JSON.parse(raw) as Record<string, string>;
    const qs = new URLSearchParams(obj).toString();
    return qs === '' ? baseUrl : `${baseUrl}?${qs}`;
  } catch {
    return baseUrl;
  }
}

const win = new BrowserWindow<typeof rpc>({
  title: 'Karttapallo',
  url: 'about:blank',
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
  const cacheFullDir = join(dataDir, 'cache', 'full');
  const cacheThumbDir = join(dataDir, 'cache', 'thumb');

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

const { backupAlbumsToICloud } = await import('./icloud-backup');

if (!isDev) {
  backupAlbumsToICloud(dataDir).catch((err: unknown) => {
    console.log(
      '[main] iCloud backup skipped:',
      err instanceof Error ? err.message : String(err)
    );
  });
}

// Load the webview immediately with snapshot data, then reload only if the
// post-startup rebuild detected actual changes. The change-detection skips
// the reload when the snapshot already matched fresh data — keeps cold starts
// flicker-free in the common case.
win.webview.loadURL(buildViewUrl());
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
