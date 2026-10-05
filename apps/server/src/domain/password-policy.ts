/**
 * Password strength beyond the length rule (FR-006.3, constitution §6.2). Pure. Rejects the
 * passwords people actually type in schools: common ones (English and Portuguese), a single
 * repeated character, keyboard/number runs, and anything built from the username or the product.
 */
const COMMON = new Set([
  '1234567890',
  '12345678910',
  '0123456789',
  '9876543210',
  '1111111111',
  '0000000000',
  '1234512345',
  '1122334455',
  '1212121212',
  '1q2w3e4r5t',
  '1qaz2wsx3edc',
  'qwertyuiop',
  'asdfghjkl;',
  'zxcvbnm123',
  'qwerty1234',
  'qwerty12345',
  'q1w2e3r4t5',
  'password12',
  'password123',
  'password1!',
  'passw0rd123',
  'iloveyou12',
  'letmein123',
  'welcome123',
  'abc1234567',
  'abcdefghij',
  'abcd123456',
  'administrator',
  'admin12345',
  'admin123456',
  'administrador',
  'adminadmin',
  'changeme123',
  'trustno1234',
  'football123',
  'princess123',
  'sunshine123',
  'superman123',
  'starwars123',
  'dragon1234',
  'monkey1234',
  'master1234',
  'senha12345',
  'senha123456',
  'senhasenha',
  'minhasenha',
  'minhasenha1',
  'minhasenha123',
  'mudar12345',
  'mudarsenha',
  'trocar1234',
  'trocarsenha',
  'escola1234',
  'escola2024',
  'escola2025',
  'escola2026',
  'faculdade1',
  'faculdade123',
  'faculdade2026',
  'laboratorio',
  'laboratorio1',
  'professor1',
  'professor123',
  'aluno12345',
  'brasil1234',
  'brasil2024',
  'brasil2025',
  'brasil2026',
  'flamengo123',
  'corinthians',
  'palmeiras1',
  'saopaulo123',
  'vasco12345',
  'gremio1234',
  'cruzeiro123',
  'botafogo123',
  'fluminense',
  'internacional',
  'santos1234',
  'amorzinho1',
  'teamo12345',
  'jesus12345',
  'deusefiel1',
  'deus123456',
  'familia123',
  'computador',
  'computador1',
  'informatica',
  'informatica1',
  'windows123',
  'windows1010',
  'microsoft1',
  'internet123',
  'wifi123456',
  'rede123456',
  'servidor123',
  'suporte123',
  'suporte1234',
  'tecnico123',
  'ti12345678',
]);

const RUNS = ['01234567890', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** True when the password is too easy to guess even though it is long enough. */
export function isWeakPassword(password: string, username?: string): boolean {
  const p = fold(password);
  if (COMMON.has(p)) return true;
  if (new Set(p).size <= 2) return true; // "aaaaaaaaaa", "abababababab"
  const core = p.replace(/[^a-z0-9]/g, '');
  for (const run of RUNS) {
    const forward = run.includes(core) || run.split('').reverse().join('').includes(core);
    if (core.length >= 6 && forward) return true;
  }
  const words = ['uniwake', 'wakeonlan', username ? fold(username) : ''].filter(
    (w) => w.length >= 3,
  );
  // The username or product name plus only digits/symbols: "admin2026!", "uniwake123".
  return words.some((w) => p.includes(w) && p.replace(w, '').replace(/[^a-z]/g, '').length < 3);
}
