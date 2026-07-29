import { InvalidNameError, type AlbumStore } from './album-store';
import type {
  EditResults,
  ItemStore,
  LocationEdit,
  TimeEdit
} from './item-store';
import type { OrsClient } from './ors-client';
import type { PhotosLibrary } from './photos-library';
import { setSetting } from './state';
import { serveVideo } from './video-stream';

function serverError(context: string, err: unknown): Response {
  if (err instanceof InvalidNameError) {
    return new Response(err.message, { status: 400 });
  }
  console.error(`${context} error:`, err);
  return new Response('Internal server error', { status: 500 });
}

interface SetLocationsBody {
  edits: LocationEdit[];
  timeEdits?: TimeEdit[];
}

export type EditResultKind = 'location' | 'time';

export interface EditResultEvent {
  kind: EditResultKind;
  uuid: string;
  ok: boolean;
  error?: string;
}

interface ApiHandlerOptions {
  itemStore: ItemStore;
  photosLibrary: PhotosLibrary;
  albumStore: AlbumStore;
  orsClient: OrsClient;
  /** Optional per-edit callback fired during save-edits — used by the dev server for terminal output. */
  onEditResult?: (event: EditResultEvent) => void;
}

/**
 * Create API route handler parameterized by the per-library data directory
 * (`data/libraries/{key}/`) — it owns `items.json`, `cache/`, `albums/`, and
 * the per-library `view` setting persisted by `PUT /api/view-state`. Global
 * settings (`window`, `ors_api_key`) live in the top-level `state.json` and are
 * handled outside this seam.
 */
export function createApiHandler(dataDir: string, options: ApiHandlerOptions) {
  const { itemStore, photosLibrary, albumStore, orsClient, onEditResult } =
    options;

  async function handleUploadAlbumFile(
    req: Request,
    album: string
  ): Promise<Response> {
    try {
      const formData = await req.formData();
      const files = await albumStore.uploadFiles(album, formData);
      if (files.length === 0) {
        return new Response('No valid files (.gpx, .md) in upload', {
          status: 400
        });
      }
      return Response.json({ ok: true, files });
    } catch (err) {
      return serverError('handleUploadAlbumFile', err);
    }
  }

  async function handleGetAlbumFiles(album: string): Promise<Response> {
    try {
      return Response.json(await albumStore.listFiles(album));
    } catch (err) {
      return serverError('handleGetAlbumFiles', err);
    }
  }

  async function handleDeleteAlbumFile(
    album: string,
    filename: string
  ): Promise<Response> {
    try {
      await albumStore.deleteFile(album, filename);
      return Response.json({ ok: true });
    } catch (err) {
      return serverError('handleDeleteAlbumFile', err);
    }
  }

  function handleSetFileVisibility(
    album: string,
    filename: string,
    req: Request
  ): Promise<Response> {
    return req
      .json()
      .then((body: unknown) => {
        const { visible } = body as { visible: boolean };
        albumStore.setFileVisibility(album, filename, visible);
        return Response.json({ ok: true });
      })
      .catch((err: unknown) => serverError('handleSetFileVisibility', err));
  }

  function handleGetMetadata(uuid: string): Response {
    try {
      const record = photosLibrary.getMetadata(uuid);
      if (record === null) {
        return new Response('Not found', { status: 404 });
      }
      return Response.json(record);
    } catch (err) {
      return serverError('handleGetMetadata', err);
    }
  }

  function emitEditResults(results: EditResults): void {
    if (onEditResult === undefined) return;
    for (const r of results.locationResults) {
      onEditResult({
        kind: 'location',
        uuid: r.uuid,
        ok: r.ok,
        error: r.ok ? undefined : r.error
      });
    }
    for (const r of results.timeResults) {
      onEditResult({
        kind: 'time',
        uuid: r.uuid,
        ok: r.ok,
        error: r.ok ? undefined : r.error
      });
    }
  }

  async function handleSaveEdits(req: Request): Promise<Response> {
    try {
      const body = (await req.json()) as SetLocationsBody;
      const locationEdits = Array.isArray(body.edits) ? body.edits : [];
      const timeEdits = Array.isArray(body.timeEdits) ? body.timeEdits : [];

      if (locationEdits.length === 0 && timeEdits.length === 0) {
        return new Response('No edits provided', { status: 400 });
      }

      const results = itemStore.applyEdits({ locationEdits, timeEdits });
      emitEditResults(results);

      const failures = [...results.locationResults, ...results.timeResults]
        .filter((r) => !r.ok)
        .map((r) => ({ uuid: r.uuid, error: r.error }));

      return Response.json({ ok: failures.length === 0, failures });
    } catch (err) {
      return serverError('handleSaveEdits', err);
    }
  }

  /** Serve an image via on-demand conversion + cache. */
  function handleImageRequest(
    uuid: string,
    size: 'full' | 'thumb'
  ): Response | null {
    try {
      const cachedPath = photosLibrary.resolveImagePath(uuid, size);
      if (cachedPath === null) return null;
      return new Response(Bun.file(cachedPath));
    } catch (err) {
      console.error(`[image-cache] Error resolving ${size}/${uuid}:`, err);
      return null;
    }
  }

  async function handleGetRoute(album: string): Promise<Response> {
    try {
      const content = await albumStore.getRouteBytes(album);
      if (content === null) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(content, {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return serverError('handleGetRoute', err);
    }
  }

  async function handlePutRoute(
    album: string,
    req: Request
  ): Promise<Response> {
    try {
      const body = await req.text();
      await albumStore.putRouteBytes(album, body);
      return Response.json({ ok: true });
    } catch (err) {
      return serverError('handlePutRoute', err);
    }
  }

  async function handleDeleteRoute(album: string): Promise<Response> {
    try {
      await albumStore.deleteRoute(album);
      return Response.json({ ok: true });
    } catch (err) {
      return serverError('handleDeleteRoute', err);
    }
  }

  async function handleRouteProxy(req: Request): Promise<Response> {
    try {
      const body = (await req.json()) as {
        coordinates: Array<[number, number]>;
        profile: string;
      };
      return await orsClient.route(body);
    } catch (err) {
      return serverError('handleRouteProxy', err);
    }
  }

  /** Route an API request. Returns null if the path doesn't match any API route. */
  // eslint-disable-next-line complexity -- routing dispatch with multiple patterns
  function routeApiRequest(
    req: Request,
    pathname: string
  ): Promise<Response | null> | Response | null {
    if (pathname === '/api/items' && req.method === 'GET') {
      return Response.json(itemStore.getAll());
    }

    if (pathname === '/api/view-state' && req.method === 'PUT') {
      return req
        .json()
        .then((body: unknown) => {
          setSetting(dataDir, 'view', JSON.stringify(body));
          return new Response(null, { status: 204 });
        })
        .catch(() => new Response('Bad request', { status: 400 }));
    }

    if (pathname === '/api/save-edits' && req.method === 'POST') {
      return handleSaveEdits(req);
    }

    if (pathname === '/api/route' && req.method === 'POST') {
      return handleRouteProxy(req);
    }

    const routeMatch = /^\/api\/albums\/(?<album>[^/]+)\/route$/.exec(pathname);
    if (routeMatch?.groups !== undefined) {
      const album = decodeURIComponent(routeMatch.groups.album!);
      if (req.method === 'GET') return handleGetRoute(album);
      if (req.method === 'PUT') return handlePutRoute(album, req);
      if (req.method === 'DELETE') return handleDeleteRoute(album);
    }

    const uploadMatch = /^\/api\/albums\/(?<album>.+)\/upload$/.exec(pathname);
    if (uploadMatch?.groups !== undefined && req.method === 'POST') {
      return handleUploadAlbumFile(
        req,
        decodeURIComponent(uploadMatch.groups.album!)
      );
    }

    const albumFilesMatch = /^\/api\/albums\/(?<album>[^/]+)\/files$/.exec(
      pathname
    );
    if (albumFilesMatch?.groups !== undefined && req.method === 'GET') {
      return handleGetAlbumFiles(
        decodeURIComponent(albumFilesMatch.groups.album!)
      );
    }

    const visibilityMatch =
      /^\/api\/albums\/(?<album>[^/]+)\/files\/(?<filename>[^/]+)\/visibility$/.exec(
        pathname
      );
    if (visibilityMatch?.groups !== undefined && req.method === 'PUT') {
      return handleSetFileVisibility(
        decodeURIComponent(visibilityMatch.groups.album!),
        decodeURIComponent(visibilityMatch.groups.filename!),
        req
      );
    }

    const deleteFileMatch =
      /^\/api\/albums\/(?<album>[^/]+)\/files\/(?<filename>[^/]+)$/.exec(
        pathname
      );
    if (deleteFileMatch?.groups !== undefined && req.method === 'DELETE') {
      return handleDeleteAlbumFile(
        decodeURIComponent(deleteFileMatch.groups.album!),
        decodeURIComponent(deleteFileMatch.groups.filename!)
      );
    }

    const metadataMatch = /^\/api\/metadata\/(?<id>[A-F0-9-]+)$/i.exec(
      pathname
    );
    if (metadataMatch?.groups !== undefined && req.method === 'GET') {
      return handleGetMetadata(metadataMatch.groups.id!);
    }

    // On-demand image serving: /full/{uuid}.jpg and /thumb/{uuid}.jpg
    if (req.method === 'GET') {
      const imageMatch =
        /^\/(?<size>full|thumb)\/(?<id>[A-F0-9-]+)\.jpg$/i.exec(pathname);
      if (imageMatch?.groups !== undefined) {
        return handleImageRequest(
          imageMatch.groups.id!,
          imageMatch.groups.size! as 'full' | 'thumb'
        );
      }
    }

    // Direct video streaming from the Photos library (range-aware)
    if (req.method === 'GET') {
      const videoMatch = /^\/video\/(?<id>[A-F0-9-]+)$/i.exec(pathname);
      if (videoMatch?.groups !== undefined) {
        return serveVideo(
          photosLibrary.resolveVideoPath(videoMatch.groups.id!),
          req
        );
      }
    }

    return null;
  }

  return { routeApiRequest };
}
