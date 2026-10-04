import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Banner, EmptyState, ErrorState, LoadingState } from '../src/components/Banner';
import { routes } from '../src/router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('app shell (constitution §8)', () => {
  it('renders pt-BR navigation, a skip link and the main landmark', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    for (const label of [
      'Painel',
      'Dispositivos',
      'Agendamentos',
      'Histórico',
      'Preparar máquinas',
      'Configurações',
      'Saúde do sistema',
    ]) {
      expect(nav).toHaveTextContent(label);
    }
    expect(screen.getByRole('link', { name: 'Pular para o conteúdo' })).toHaveAttribute(
      'href',
      '#conteudo',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'conteudo');
  });

  it('marks the current page in the navigation', () => {
    renderAt('/dispositivos');
    expect(screen.getByRole('link', { name: 'Dispositivos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Dispositivos' })).toBeInTheDocument();
  });

  it('shows a not-found page for unknown routes', () => {
    renderAt('/nao-existe');
    expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeInTheDocument();
  });
});

describe('state components', () => {
  it('banners use status/alert roles by tone', () => {
    render(
      <>
        <Banner tone="warning">Modo simulação ativo</Banner>
        <Banner tone="danger">Atualização revertida</Banner>
      </>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Modo simulação ativo');
    expect(screen.getByRole('alert')).toHaveTextContent('Atualização revertida');
  });

  it('loading, empty and error states', () => {
    let retried = 0;
    render(
      <>
        <LoadingState />
        <EmptyState title="Nenhuma sala cadastrada">Crie a primeira sala.</EmptyState>
        <ErrorState message="Falhou" onRetry={() => retried++} />
      </>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Carregando…');
    expect(screen.getByText('Nenhuma sala cadastrada')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Tentar novamente' }).click();
    expect(retried).toBe(1);
  });
});
