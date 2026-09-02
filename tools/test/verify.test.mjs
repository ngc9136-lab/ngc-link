// Prueba de verify-front.mjs: contra un front sano tiene que salir 0,
// y contra uno roto tiene que salir 1 y nombrar las 6 fallas.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrancar } from '../fixtures/front-falso.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const VERIF = path.join(AQUI, '..', 'verify-front.mjs');

const correr = (args) =>
  new Promise((resolve) =>
    execFile('node', [VERIF, ...args], { maxBuffer: 1 << 24 }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr })
    )
  );

const { server, base } = await arrancar();
let fallos = 0;
const prueba = (n, fn) => {
  try { fn(); console.log('  ok   ' + n); }
  catch (e) { fallos++; console.log('  FALLA ' + n + '\n        ' + e.message); }
};

const sano = await correr(['--store', base, '--listado', base + '/', '--producto', base + '/ficha']);
const roto = await correr(['--store', base, '--listado', base + '/?roto=1', '--producto', base + '/ficha?roto=1']);

console.log('\n--- front sano ---');
console.log(sano.stdout.split('\n').filter((l) => /OK |FALLA |chequeos/.test(l)).join('\n'));
console.log('--- front roto ---');
console.log(roto.stdout.split('\n').filter((l) => /OK |FALLA |chequeos/.test(l)).join('\n'));
console.log('');

prueba('front sano: codigo de salida 0', () => assert.equal(sano.code, 0));
prueba('front sano: pasan los 7 chequeos', () => assert.match(sano.stdout, /7\/7 chequeos pasan/));
prueba('front roto: codigo de salida 1', () => assert.equal(roto.code, 1));
prueba('front roto: detecta el bloque ngc-fix ausente', () => assert.match(roto.stdout, /FALLA existen #ngc-fix/));
prueba('front roto: detecta los banners que no cargan', () => assert.match(roto.stdout, /FALLA los 4 banners/));
prueba('front roto: detecta line-clamp sobre .item-link', () => assert.match(roto.stdout, /FALLA \.item-link/));
prueba('front roto: detecta el contraste bajo del boton', () => assert.match(roto.stdout, /FALLA \.btn-primary/));
prueba('front roto: detecta nombres cortados en celular', () => assert.match(roto.stdout, /FALLA ningun nombre cortado en el listado \(celular/));
prueba('front roto: detecta la ficha kilometrica', () => assert.match(roto.stdout, /FALLA la ficha mide menos/));

server.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} PRUEBAS FALLADAS`);
process.exit(fallos === 0 ? 0 : 1);
