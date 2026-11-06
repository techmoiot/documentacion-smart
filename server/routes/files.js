// Fotografías y archivos adjuntos (almacenados en disco, metadatos en SQLite)
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run } from '../db.js';
import { require_, requireAuth } from '../auth.js';
import { audit } from '../audit.js';
import { UPLOAD_DIR, MAX_UPLOAD_MB } from '../config.js';
import { wrap, bad, notFound, intParam } from '../http.js';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ENTITY_TABLE = { node: 'nodes', device: 'devices', rack: 'racks', radiolink: 'radiolinks', antenna: 'antennas', fiber: 'fiber_elements' };
const ENTITY_AUDIT = { node: 'nodes', device: 'devices', rack: 'racks', radiolink: 'radiolinks', antenna: 'antennas', fiber: 'fiber' };

const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const DOC_EXT = new Set(['.pdf', '.txt', '.csv', '.md', '.json', '.log', '.rsc', '.cfg', '.conf', '.docx', '.xlsx', '.pptx', '.zip', '.backup']);

function sniffImage(buf, ext) {
  const h = buf.subarray(0, 12);
  if (ext === '.jpg' || ext === '.jpeg') return h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
  if (ext === '.png') return h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ext === '.gif') return h.subarray(0, 4).toString('latin1') === 'GIF8';
  if (ext === '.webp') return h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP';
  return false;
}

export const router = express.Router();

router.get('/files', requireAuth, wrap((req, res) => {
  const type = String(req.query.entity_type || '');
  if (!ENTITY_TABLE[type]) throw bad('Tipo de entidad inválido');
  const id = intParam(req.query.entity_id, 'entity_id');
  res.json(all('SELECT id, entity_type, entity_id, kind, original_name, mime, size, caption, uploaded_by, created_at FROM files WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC', type, id));
}));

router.post(
  '/files',
  require_('update'),
  express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` }),
  wrap((req, res) => {
    const type = String(req.query.entity_type || '');
    if (!ENTITY_TABLE[type]) throw bad('Tipo de entidad inválido');
    const id = intParam(req.query.entity_id, 'entity_id');
    if (!get(`SELECT 1 AS x FROM ${ENTITY_TABLE[type]} WHERE id = ?`, id)) throw notFound('Elemento');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Archivo vacío');

    const original = path.basename(String(req.query.name || 'archivo')).replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, '_').slice(0, 120) || 'archivo';
    const ext = path.extname(original).toLowerCase();
    const isImage = ext in IMAGE_TYPES;
    if (!isImage && !DOC_EXT.has(ext)) throw bad(`Tipo de archivo no permitido (${ext || 'sin extensión'})`);
    if (isImage && !sniffImage(req.body, ext)) throw bad('El contenido no corresponde a una imagen válida');
    if (ext === '.pdf' && req.body.subarray(0, 5).toString('latin1') !== '%PDF-') throw bad('El archivo no es un PDF válido');

    const stored = `${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, stored), req.body, { flag: 'wx' });
    const mime = isImage ? IMAGE_TYPES[ext] : ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
    const kind = isImage ? 'photo' : 'doc';
    const r = run(
      'INSERT INTO files (entity_type, entity_id, kind, stored_name, original_name, mime, size, caption, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)',
      type, id, kind, stored, original, mime, req.body.length, String(req.query.caption || '').slice(0, 200), req.user.username);
    audit(req.user, 'modificar', ENTITY_AUDIT[type], id, `Adjuntó ${kind === 'photo' ? 'fotografía' : 'archivo'} «${original}»`);
    res.status(201).json(get('SELECT id, entity_type, entity_id, kind, original_name, mime, size, caption, uploaded_by, created_at FROM files WHERE id = ?', Number(r.lastInsertRowid)));
  })
);

router.patch('/files/:id', require_('update'), wrap((req, res) => {
  const id = intParam(req.params.id);
  if (!get('SELECT 1 AS x FROM files WHERE id = ?', id)) throw notFound('Archivo');
  run('UPDATE files SET caption = ? WHERE id = ?', String(req.body?.caption ?? '').slice(0, 200), id);
  res.json(get('SELECT id, caption FROM files WHERE id = ?', id));
}));

router.delete('/files/:id', require_('write'), wrap((req, res) => {
  const id = intParam(req.params.id);
  const f = get('SELECT * FROM files WHERE id = ?', id);
  if (!f) throw notFound('Archivo');
  run('DELETE FROM files WHERE id = ?', id);
  try { fs.unlinkSync(path.join(UPLOAD_DIR, f.stored_name)); } catch { /* ya no existe */ }
  audit(req.user, 'modificar', ENTITY_AUDIT[f.entity_type], f.entity_id, `Eliminó archivo «${f.original_name}»`);
  res.json({ ok: true });
}));

// Descarga / visualización (requiere sesión)
export const fileServer = express.Router();
fileServer.get('/:id', requireAuth, wrap((req, res) => {
  const f = get('SELECT * FROM files WHERE id = ?', intParam(req.params.id));
  if (!f) throw notFound('Archivo');
  const full = path.join(UPLOAD_DIR, f.stored_name);
  if (!fs.existsSync(full)) throw notFound('Archivo');
  res.setHeader('Content-Type', f.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=3600');
  const inline = f.kind === 'photo' || f.mime === 'application/pdf';
  res.setHeader('Content-Disposition', `${inline && req.query.download !== '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
  fs.createReadStream(full).pipe(res);
}));
