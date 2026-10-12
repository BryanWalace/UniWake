import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HELP_TOPICS } from '@uniwake/shared';
import { loggedInApi, renderApp } from './helpers';

afterEach(() => vi.unstubAllGlobals());

describe('help pages (FR-007.5)', () => {
  it('the index links every topic', async () => {
    loggedInApi();
    renderApp('/ajuda');
    expect(await screen.findByRole('heading', { level: 1, name: 'Ajuda' })).toBeInTheDocument();
    const links = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
      .filter((h) => h?.startsWith('/ajuda/'));
    expect(links).toEqual(HELP_TOPICS.map((t) => `/ajuda/${t}`));
  });

  it.each(HELP_TOPICS)(
    'AC-007-15: /ajuda/%s renders with a title and instructions',
    async (topic) => {
      loggedInApi();
      renderApp(`/ajuda/${topic}`);
      const h1 = await screen.findByRole('heading', { level: 1 });
      expect(h1.textContent).not.toBe('');
      expect(screen.getByRole('article').textContent.length).toBeGreaterThan(400);
    },
  );

  it('an unknown topic offers the index', async () => {
    loggedInApi();
    renderApp('/ajuda/nao-existe');
    expect(await screen.findByText('Página de ajuda não encontrada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver todas as páginas de ajuda' })).toHaveAttribute(
      'href',
      '/ajuda',
    );
  });
});

describe('v1.3 help (FR-311)', () => {
  it('AC-311-01: both remote shutdown pages open from the help index', async () => {
    loggedInApi();
    const user = userEvent.setup();
    const { unmount } = renderApp('/ajuda');
    await user.click(await screen.findByRole('link', { name: 'Desligar computadores' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Desligar computadores' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('Nunca desligar por agendamento');
    unmount();
    renderApp('/ajuda');
    await user.click(
      await screen.findByRole('link', { name: 'Laboratórios com Deep Freeze ou similar' }),
    );
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Laboratórios com Deep Freeze ou similar',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('Pasta persistente');
  });
});
