import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, PORT, HOST } from './config.js';
import { get } from './db.js';
import { sessionMiddleware, requireAuth } from './auth.js';
import { HttpError } from './http.js';
import { router as usersRouter } from './routes/users.js';
import { router as crudRouter } from './routes/crud.js';
import { router as viewsRouter } from './routes/views.js';
import { router as filesRouter, fileServer } from './routes/files.js';
import { readVersion } from './version.js';
import { router as importRouter } from './routes/import.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : process.env.TRUST_PROXY);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    // OpenStreetMap exige Referer en las teselas (su política de uso): se envía solo el origen, nunca la ruta
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
    );
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(sessionMiddleware);

  // Protección CSRF: toda petición que modifica datos debe llevar la cabecera propia del cliente
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'SmartDoc') {
      return res.status(403).json({ error: 'Petición no permitida' });
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, version: readVersion() }));
  app.use('/api', usersRouter);
  app.use('/api', requireAuth, crudRouter);
  app.use('/api', requireAuth, viewsRouter);
  app.use('/api', requireAuth, filesRouter);
  app.use('/api', requireAuth, importRouter);
  app.use('/files', fileServer);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], maxAge: '5m' }));
  app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Archivo demasiado grande' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });
  return app;
}

export { readVersion };

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const app = createApp();
  const n = get('SELECT COUNT(*) AS n FROM users').n;
  if (n === 0) console.warn('⚠ No hay usuarios. Cree un administrador con:  document create-admin <usuario>');
  app.listen(PORT, HOST, () => console.log(`Smart Connection · Documentación de red escuchando en http://${HOST}:${PORT}`));
}
