import {
  classifySupabaseKey,
  isPrivilegedSupabaseKey,
  decodeJwtPayload,
} from '../src/server/rpcAuthorization.ts';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
  }
}

function jwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `eyJhbGciOiJIUzI1NiJ9.${encoded}.signature`;
}

console.log('[RPC authorization key classification]');
check('service_role JWT ayrıcalıklıdır', classifySupabaseKey(jwt({ role: 'service_role' })) === 'privileged');
check('supabase_admin JWT ayrıcalıklıdır', classifySupabaseKey(jwt({ role: 'supabase_admin' })) === 'privileged');
check('anon JWT yayın anahtarıdır', classifySupabaseKey(jwt({ role: 'anon' })) === 'publishable');
check('authenticated JWT yayın anahtarıdır', classifySupabaseKey(jwt({ role: 'authenticated' })) === 'publishable');
check('sb_secret_ anahtarı ayrıcalıklıdır', classifySupabaseKey('sb_secret_abc') === 'privileged');
check('sb_publishable_ anahtarı yayındır', classifySupabaseKey('sb_publishable_abc') === 'publishable');
check('boş anahtar bilinmez', classifySupabaseKey('') === 'unknown');
check('rastgele anahtar bilinmez', classifySupabaseKey('not-a-jwt') === 'unknown');
check('eksik rol bilinmez', classifySupabaseKey(jwt({ sub: 'x' })) === 'unknown');
check('bozuk JWT bilinmez', classifySupabaseKey('a.!!!.c') === 'unknown');
check('isPrivilegedSupabaseKey anon için false', !isPrivilegedSupabaseKey(jwt({ role: 'anon' })));
check('isPrivilegedSupabaseKey service_role için true', isPrivilegedSupabaseKey(jwt({ role: 'service_role' })));

console.log('[JWT payload decoding]');
const decoded = decodeJwtPayload(jwt({ role: 'service_role', ref: 'project' }));
check('rol alanı çözümlenir', decoded?.role === 'service_role');
check('proje referansı çözümlenir', decoded?.ref === 'project');
check('imza olmadan yük çözümlenmez', decodeJwtPayload('onlypayload') === null);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
