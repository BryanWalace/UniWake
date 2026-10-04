import { Banner } from '../../components/Banner';
import { useDashboard } from './api';

/** Shown on every page while the hub runs with `--demo` (FR-015). */
export function DemoBanner() {
  const dash = useDashboard();
  if (!dash.data?.demo) return null;
  return (
    <Banner tone="warning">
      <strong>Modo demonstração.</strong> As máquinas são simuladas e nenhum pacote real é enviado à
      rede.
    </Banner>
  );
}
