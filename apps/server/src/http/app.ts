import { gunzipSync } from 'node:zlib';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { DEFAULT_HALF_SIZE, PACK_VERSION, ROOM_ID_PATTERN, areaRefFor, isValidLatLng } from '@nukkad/shared';
import { AreaError } from '../areas/areaService.ts';
import type { AreaService } from '../areas/areaService.ts';
import type { RoomManager } from '../realtime/rooms.ts';
import { TokenBuckets } from '../security/tokenBuckets.ts';

export interface AppOptions {
  areas: AreaService;
  rooms: RoomManager;
  /** New rooms per IP: a burst, then this many per minute. */
  roomBurst?: number;
  roomsPerMinute?: number;
  allowedOrigins: string[];
  trustProxy: boolean;
  /** Requests to /api/areas per minute per IP (cached packs are cheap). */
  areaRequestsPerMinute?: number;
  /** New (uncached) places per IP: a burst, then this many per minute. Generous for shared school Wi-Fi. */
  newAreaBurst?: number;
  newAreasPerMinute?: number;
}

const sendError = (res: Response, status: number, code: string, message: string): void => {
  res.setHeader('Cache-Control', 'no-store'); // an error must never be remembered by a browser
  res.status(status).json({ error: code, message });
};

const queryNumber = (value: unknown): number => (typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN);

export function createApp(options: AppOptions): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (options.trustProxy) app.set('trust proxy', 1);

  // Cross-origin access only for the web app's own address (same-origin needs nothing).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && options.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, name: 'nukkad', packVersion: PACK_VERSION });
  });

  const areaLimiter = rateLimit({
    windowMs: 60_000,
    limit: options.areaRequestsPerMinute ?? 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => sendError(res, 429, 'slow_down', 'Too many requests. Wait a moment and try again.'),
  });
  const newAreas = new TokenBuckets(options.newAreaBurst ?? 6, options.newAreasPerMinute ?? 2);

  /**
   * GET /api/areas?lat=..&lng=..[&r=..][&v=..] → the Area Pack (gzipped JSON) for that spot.
   * The web app sends the pack version it understands as `v`. Because `v` is part of the
   * address, a browser can never reuse a cached pack of an older format.
   */
  app.get('/api/areas', areaLimiter, async (req: Request, res: Response) => {
    const lat = queryNumber(req.query.lat);
    const lng = queryNumber(req.query.lng);
    const radius = req.query.r === undefined ? DEFAULT_HALF_SIZE : queryNumber(req.query.r);
    if (!isValidLatLng(lat, lng) || !Number.isFinite(radius)) {
      sendError(res, 400, 'bad_request', 'Give lat and lng as numbers, for example ?lat=12.921&lng=77.695');
      return;
    }
    if (req.query.v !== undefined && queryNumber(req.query.v) !== PACK_VERSION) {
      sendError(res, 409, 'version_mismatch', 'Nukkad was updated. Reload the page to get the new version.');
      return;
    }
    const ref = areaRefFor(lat, lng, radius);
    try {
      // Only brand-new places cost a request to OpenStreetMap, so only those are tightly limited.
      if (!(await options.areas.isCached(ref)) && !newAreas.consume(req.ip ?? 'unknown')) {
        sendError(res, 429, 'slow_down', 'You are opening new places very fast. Wait a minute and try again.');
        return;
      }
      const gz = await options.areas.getPackGz(ref);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.vary('Accept-Encoding');
      res.setHeader('X-Nukkad-Area', ref.id);
      if (req.acceptsEncodings('gzip')) {
        res.setHeader('Content-Encoding', 'gzip');
        res.end(gz);
      } else {
        res.end(gunzipSync(gz));
      }
    } catch (error) {
      if (error instanceof AreaError) sendError(res, error.status, error.code, error.message);
      else sendError(res, 500, 'server_error', 'Something went wrong on our side.');
    }
  });

  const newRooms = new TokenBuckets(options.roomBurst ?? 5, options.roomsPerMinute ?? 2);

  /** POST /api/rooms {lat, lng} → a new invite-only room. There is no way to list rooms. */
  app.post('/api/rooms', express.json({ limit: '1kb' }), (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { lat?: unknown; lng?: unknown };
    if (!isValidLatLng(body.lat, body.lng)) {
      sendError(res, 400, 'bad_request', 'Give lat and lng as numbers.');
      return;
    }
    if (!newRooms.consume(req.ip ?? 'unknown')) {
      sendError(res, 429, 'slow_down', 'You are making rooms very fast. Wait a minute and try again.');
      return;
    }
    const info = options.rooms.create(body.lat as number, body.lng as number);
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json(info);
  });

  /** GET /api/rooms/:id → the place of a room (needed before joining to load its map). */
  app.get('/api/rooms/:id', areaLimiter, (req: Request, res: Response) => {
    const id = String(req.params.id);
    const room = ROOM_ID_PATTERN.test(id) ? options.rooms.get(id) : undefined;
    res.setHeader('Cache-Control', 'no-store');
    if (!room) {
      sendError(res, 404, 'room_not_found', 'This invite link has expired or is wrong.');
      return;
    }
    res.json({ ...room.info, players: room.members.filter(Boolean).length });
  });

  app.use((_req, res) => sendError(res, 404, 'not_found', 'No such page.'));
  return app;
}
