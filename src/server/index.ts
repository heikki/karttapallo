import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const {
  BrowserView,
  BrowserWindow,
  ApplicationMenu,
  Utils,
  default: Electrobun
} = await import('electrobun/bun');

const { createAlbumStore } = await import('./album-store');
const { createApiHandler } = await import('./api-routes');
const { claimCacheRoot } = await import('./cache-root');
const { parseDeepLink, deepLinkViewUrl } = await import('./deep-link');
const { openItemStore } = await import('./item-store');
const { createOrsClient } = await import('./ors-client');
const {
  createImageCache,
  openPhotosLibrary,
  readAlbums,
  resolveLibrary,
  libraryTitle
} = await import('./photos-library');
const { createPhotosWriter } = await import('./photos-edit');
const { createRequestHandler } = await import('./request-handler');
const { getSetting, setSetting } = await import('./state');

// --- Deep links ------------------------------------------------------------
//
// macOS delivers `karttapallo://photo/<uuid>` as an `open-url` event. Two
// arrival times have to work: the app was already running (navigate the
// window we have), or macOS launched it to handle the link — in which case
// the event can land before the window exists. Electrobun's native side keeps
// no queue for that case, so the uuid is buffered here and consumed as the
// window's initial URL.
//
// Registered before everything below because library resolution can sit in a
// modal for as long as the user leaves it up, and a link that arrives while
// that dialog is open still has to survive.
let pendingDeepLinkUuid: string | null = null;
let deliverDeepLink: ((uuid: string) => void) | null = null;

Electrobun.events.on('open-url', (event: { data: { url: string } }) => {
  const link = parseDeepLink(event.data.url);
  if (link === null) {
    console.log(`[main] Ignoring unparseable deep link: ${event.data.url}`);
    return;
  }
  console.log(`[main] Deep link: ${link.uuid}`);
  if (deliverDeepLink === null) pendingDeepLinkUuid = link.uuid;
  else deliverDeepLink(link.uuid);
});

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

function defaultSupportDir() {
  return join(process.env.HOME!, 'Library/Application Support/Karttapallo');
}

function findSupportDir() {
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

  return defaultSupportDir();
}

/**
 * `~/Library/Caches` is the Time Machine exclusion that survives a cache clear
 * (docs/gotchas.md). A run that redirected the support dir keeps its derived
 * data beside it instead, so one directory holds everything that run created.
 */
function findCacheRoot(supportDir: string) {
  if (supportDir !== defaultSupportDir()) return join(supportDir, 'derived');
  return join(process.env.HOME!, 'Library/Caches/Karttapallo');
}

const supportDir = findSupportDir();
console.log(`[main] Support directory: ${supportDir}`);

mkdirSync(supportDir, { recursive: true });

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
async function resolveLibraryOrExit() {
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

const bundleDir = join(libraryPath, 'karttapallo');
const cacheRoot = claimCacheRoot(findCacheRoot(supportDir), libraryPath);
console.log(`[main] Library: ${libraryPath}`);
console.log(`[main] Library data: ${bundleDir}`);
console.log(`[main] Derived data: ${cacheRoot}`);

const imageCache = createImageCache({
  cacheDir: join(cacheRoot, 'cache'),
  libraryPath
});
const photosLibrary = openPhotosLibrary({ imageCache, libraryPath });
const itemStore = openItemStore({
  cacheRoot,
  imageCache,
  libraryPath,
  photosWriter: createPhotosWriter(libraryPath)
});
const albumStore = createAlbumStore(bundleDir, () => readAlbums(libraryPath));
const orsClient = createOrsClient(supportDir);

// Prune after the rebuild rather than at startup: a rebuild that finished is
// the one moment we know the library was readable, which is what makes a
// missing album mean the user deleted it.
itemStore.rebuildComplete
  .then(() => {
    albumStore.pruneOrphans();
  })
  .catch(() => {
    /* a failed rebuild says nothing about which albums are live */
  });
const { routeApiRequest } = createApiHandler(bundleDir, {
  itemStore,
  photosLibrary,
  albumStore,
  orsClient
});

const appDir = join(resourcesDir, 'app');
const viewsDir = join(appDir, 'views', 'app');

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
  // Not decoration. On macOS the text-editing shortcuts are key equivalents
  // dispatched through the application menu, so without these items Cmd+A,
  // Cmd+C and friends never reach the webview's field editor at all — typing
  // in the search box worked while selecting what you typed did nothing. The
  // roles map to NSResponder selectors and act on the first responder, so
  // Select All selects the focused input's text and nothing else. Electrobun
  // assigns no default accelerators, hence each one spelled out.
  {
    label: 'Edit',
    submenu: [
      { role: 'undo', accelerator: 'CmdOrCtrl+Z' },
      { role: 'redo', accelerator: 'Shift+CmdOrCtrl+Z' },
      { type: 'divider' },
      { role: 'cut', accelerator: 'CmdOrCtrl+X' },
      { role: 'copy', accelerator: 'CmdOrCtrl+C' },
      { role: 'paste', accelerator: 'CmdOrCtrl+V' },
      { type: 'divider' },
      { role: 'selectAll', accelerator: 'CmdOrCtrl+A' }
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
  staticRoots: [viewsDir],
  onResponse: async (req, res, pathname) => {
    if (pathname.startsWith('/api/')) {
      await checkFullDiskAccess(res, pathname);
    }
  }
});

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
    const raw = getSetting(supportDir, 'window');
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
  setSetting(supportDir, 'window', JSON.stringify(frame));
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

const rpc = BrowserView.defineRPC<AppRPC>({
  handlers: {
    requests: {},
    messages: {}
  }
});

const savedFrame = loadWindowState();

// `view` is per-library (it carries library-specific state — map center,
// filters, and the selected photo UUID), so it lives in the bundle, not the
// machine-scoped state.json that holds `window`. Storing it with the library
// means the view restores on whichever Mac the library is opened on.
function savedViewParams(): Record<string, string> {
  try {
    const raw = getSetting(bundleDir, 'view');
    if (raw === null) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function buildViewUrl() {
  const qs = new URLSearchParams(savedViewParams()).toString();
  return qs === '' ? baseUrl : `${baseUrl}?${qs}`;
}

// A deep link that arrived before the window existed wins over the saved
// view: the user asked for that photo just now, and the saved state is only
// where they happened to leave off.
function initialViewUrl() {
  if (pendingDeepLinkUuid === null) return buildViewUrl();
  const url = deepLinkViewUrl(baseUrl, pendingDeepLinkUuid, savedViewParams());
  pendingDeepLinkUuid = null;
  return url;
}

// Create the webview already pointing at the app URL. Electrobun passes the
// constructor `url` to the native webview at creation (see BrowserView.init),
// so this is race-free. Do NOT switch back to `about:blank` + a later
// `win.webview.loadURL()` — that second load races webview creation and gets
// dropped (window stays blank) unless something happens to yield a tick first.
const win = new BrowserWindow<typeof rpc>({
  // Names the library this session is bound to — see libraryTitle. Set at
  // construction with no setTitle follow-up: the active library is resolved
  // once per launch and cannot change under a running window (ADR-0012).
  title: `Karttapallo — ${libraryTitle(libraryPath)}`,
  url: initialViewUrl(),
  frame: savedFrame,
  rpc
});

// From here on links are delivered straight to the window. Assigned in the
// same synchronous run as the window's construction so an event can't slip
// into the gap and be dropped by a handler that still thinks it has nowhere
// to put it.
deliverDeepLink = (uuid) => {
  win.webview.loadURL(deepLinkViewUrl(baseUrl, uuid, savedViewParams()));
  win.focus();
};

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

function extractUrl(event: ElectrobunEvent) {
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
  const cacheFullDir = join(cacheRoot, 'cache', 'full');
  const cacheThumbDir = join(cacheRoot, 'cache', 'thumb');

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
