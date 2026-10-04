import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeCsvBytes } from '../src/features/devices/csv-file';
import { loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

describe('CSV file decoding', () => {
  it('reads UTF-8 files as UTF-8', () => {
    const bytes = new TextEncoder().encode('nome;observações\nPC;Mesa do professor\n');
    expect(decodeCsvBytes(bytes)).toEqual({
      text: 'nome;observações\nPC;Mesa do professor\n',
      encoding: 'utf-8',
    });
  });

  it('falls back to Windows-1252 for Excel pt-BR "CSV (separado por vírgulas)" files', () => {
    // "Observações" in Windows-1252: ç = 0xE7, õ = 0xF5 (invalid as UTF-8)
    const bytes = Uint8Array.from([
      ...new TextEncoder().encode('nome;Observa'),
      0xe7,
      0xf5,
      ...new TextEncoder().encode('es\n'),
    ]);
    expect(decodeCsvBytes(bytes)).toEqual({ text: 'nome;Observações\n', encoding: 'windows-1252' });
  });
});

const PREVIEW = {
  rows: [
    {
      line: 2,
      status: 'create',
      name: 'PC-01',
      mac: '00:AA:00:00:00:01',
      room: 'Lab 3',
      reasons: [],
    },
    { line: 3, status: 'error', name: 'PC-02', mac: 'xx', room: null, reasons: ['MAC inválido.'] },
    {
      line: 4,
      status: 'skip',
      name: 'PC-03',
      mac: '00:AA:00:00:00:03',
      room: null,
      reasons: ['MAC já cadastrado em "Velho".'],
    },
  ],
  summary: { create: 1, update: 0, skip: 1, error: 1 },
  roomsToCreate: ['Lab 3'],
  tagsToCreate: [],
  ignoredColumns: ['Patrimônio'],
};

describe('import page (FR-002.3)', () => {
  it('previews without writing, then imports and shows the result', async () => {
    const api = loggedInApi()
      .on('POST', '/api/devices/import/preview', { body: PREVIEW })
      .on('POST', '/api/devices/import/commit', {
        body: {
          created: 1,
          updated: 0,
          skipped: 1,
          errors: 1,
          roomsCreated: ['Lab 3'],
          tagsCreated: [],
        },
      });
    const user = userEvent.setup();
    renderApp('/dispositivos/importar');
    const file = new File(['nome;mac;sala\nPC-01;00:AA:00:00:00:01;Lab 3\n'], 'salas.csv', {
      type: 'text/csv',
    });
    await user.upload(await screen.findByLabelText('Arquivo CSV'), file);
    expect(await screen.findByText('salas.csv (UTF-8)')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Atualizar o dispositivo'));
    await user.click(screen.getByRole('button', { name: 'Pré-visualizar' }));

    expect(
      await screen.findByText('Pré-visualização (nada foi gravado ainda)'),
    ).toBeInTheDocument();
    const summary = screen.getByRole('list', { name: 'Resumo' });
    expect(summary).toHaveTextContent('Criar: 1');
    expect(summary).toHaveTextContent('Erro: 1');
    expect(screen.getByText('Salas novas: Lab 3')).toBeInTheDocument();
    expect(screen.getByText('Colunas ignoradas: Patrimônio')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('MAC inválido.')).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === '/api/devices/import/preview')?.body).toMatchObject({
      onDuplicate: 'update',
      createMissing: true,
      csv: expect.stringContaining('PC-01'),
    });
    expect(api.calls.some((c) => c.path === '/api/devices/import/commit')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Importar 1 dispositivo(s)' }));
    const done = await screen.findByRole('status');
    expect(done).toHaveTextContent('Importação concluída.');
    expect(done).toHaveTextContent('Criados: 1 · Atualizados: 0 · Ignorados: 1 · Com erro: 1');
  });

  it('shows the hub error for an unreadable file', async () => {
    loggedInApi().on('POST', '/api/devices/import/preview', {
      status: 422,
      body: {
        code: 'CSV_INVALID',
        message: 'Não foi possível ler o arquivo CSV: as colunas "nome" e "mac" são obrigatórias.',
      },
    });
    const user = userEvent.setup();
    renderApp('/dispositivos/importar');
    await user.upload(
      await screen.findByLabelText('Arquivo CSV'),
      new File(['ip;sala\n'], 'x.csv'),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pré-visualizar' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Pré-visualizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('"nome" e "mac" são obrigatórias');
  });

  it('the preview button stays disabled until a file is chosen', async () => {
    loggedInApi();
    renderApp('/dispositivos/importar');
    expect(await screen.findByRole('button', { name: 'Pré-visualizar' })).toBeDisabled();
  });
});
