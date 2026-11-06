// Utilidades de administración (las usa el comando `document`)
import crypto from 'node:crypto';
import fs from 'node:fs';
import { db, get, run } from './db.js';
import { hashPassword } from './auth.js';

const [cmd, ...args] = process.argv.slice(2);

function genPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

function upsertUser(username, password, role) {
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username || '')) throw new Error('Usuario inválido (3–40 caracteres: letras, números, . _ -)');
  const pwd = password || genPassword();
  if (pwd.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres');
  const existing = get('SELECT id FROM users WHERE username = ?', username);
  if (existing) {
    run('UPDATE users SET password_hash = ?, active = 1 WHERE id = ?', hashPassword(pwd), existing.id);
    run('DELETE FROM sessions WHERE user_id = ?', existing.id);
  } else {
    run('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)', username, username, hashPassword(pwd), role);
  }
  return { pwd, created: !existing };
}

try {
  switch (cmd) {
    case 'create-admin': {
      const { pwd, created } = upsertUser(args[0] || 'admin', args[1], 'admin');
      console.log(`${created ? 'Administrador creado' : 'Contraseña restablecida'}:`);
      console.log(`  usuario:    ${args[0] || 'admin'}`);
      console.log(`  contraseña: ${pwd}`);
      break;
    }
    case 'passwd': {
      if (!get('SELECT 1 AS x FROM users WHERE username = ?', args[0])) throw new Error(`No existe el usuario «${args[0]}»`);
      const { pwd } = upsertUser(args[0], args[1], 'viewer');
      console.log(`Nueva contraseña de ${args[0]}: ${pwd}`);
      break;
    }
    case 'user-count':
      console.log(get('SELECT COUNT(*) AS n FROM users').n);
      break;
    case 'list-users':
      for (const u of db.prepare('SELECT username, role, active FROM users ORDER BY username').all())
        console.log(`${u.username.padEnd(24)} ${u.role.padEnd(11)} ${u.active ? 'activo' : 'desactivado'}`);
      break;
    case 'db-backup': {
      if (!args[0]) throw new Error('Indique el archivo de destino');
      if (fs.existsSync(args[0])) fs.unlinkSync(args[0]);
      db.exec(`VACUUM INTO '${args[0].replace(/'/g, "''")}'`);
      console.log(`Base de datos respaldada en ${args[0]}`);
      break;
    }
    case 'seed-demo': {
      const { seedDemo } = await import('./seed-demo.js');
      seedDemo();
      break;
    }
    default:
      console.log('Uso: node server/cli.js <create-admin [usuario] [clave] | passwd <usuario> [clave] | list-users | db-backup <archivo> | seed-demo>');
      process.exitCode = cmd ? 1 : 0;
  }
} catch (e) {
  console.error('Error:', e.message);
  process.exitCode = 1;
}
