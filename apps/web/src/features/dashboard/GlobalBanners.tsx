import { Banner } from '../../components/Banner';
import { t } from '../../i18n/pt-BR';
import { PauseBanner } from '../schedules/Pause';
import { useDashboard } from './api';

/**
 * Page-wide banners (constitution §8), always in this order: problems first (update failure,
 * paused schedules), then modes (demo, or simulation when demo is off).
 */
export function GlobalBanners() {
  const dash = useDashboard();
  const d = dash.data;
  const updateFailed = d?.notices.find((n) => n.type === 'update_failed');
  return (
    <>
      {updateFailed && (
        <Banner tone="danger">
          <strong>A atualização do UniWake falhou</strong> e a versão anterior foi mantida.{' '}
          {typeof updateFailed.data.message === 'string' ? updateFailed.data.message : ''} Veja
          Saúde do sistema.
        </Banner>
      )}
      <PauseBanner />
      {d?.demo ? (
        <Banner tone="warning">
          <strong>Modo demonstração.</strong> As máquinas são simuladas e nenhum pacote real é
          enviado à rede.
        </Banner>
      ) : d?.dryRun ? (
        <Banner tone="warning">
          <strong>{t.banners.dryRun}</strong> Desligue em Configurações › Ligação para ligar as
          máquinas de verdade.
        </Banner>
      ) : null}
    </>
  );
}
