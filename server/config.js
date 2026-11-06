import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ROOT = root;
export const PORT = Number(process.env.PORT || 3000);
export const HOST = process.env.HOST || '0.0.0.0';
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 20);
// Poner COOKIE_SECURE=1 cuando se sirva detrás de HTTPS (proxy inverso)
export const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
// Mapa base. Para operar sin Internet, apuntar a un servidor de teselas local.
export const TILE_URL = process.env.TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = process.env.TILE_ATTRIBUTION || '&copy; OpenStreetMap';
