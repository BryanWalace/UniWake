/**
 * Values of the one-line command checked by scripts/tests/one-liner.Tests.ps1 (AC-007-14). The
 * Pester test runs the exact text `buildCommand` produces, stored in
 * scripts/tests/fixtures/one-liner.txt; enrollment-tokens.test.ts fails when the two differ.
 */
export const ONE_LINER_FIXTURE = {
  scriptUrl: 'http://127.0.0.1:47101/agent/prepare-target.ps1',
  hubUrl: 'http://127.0.0.1:47101',
  roomCode: 'LAB3',
  token: 'TOKEN_de-teste_1234567890',
  /** Script bytes the Pester test "downloads" (UTF-8). */
  script: 'Write-Host "conteúdo original do script"\r\n',
};
