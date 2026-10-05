/**
 * Network settings preview (FR-011, IMP-007): the interfaces this computer has, which ones the
 * hub sends from and why, and the exact destinations a wake uses — computed with the same
 * functions as the wake engine, so the preview cannot drift from what is sent.
 */
import {
  isApipa,
  isLoopback,
  type NetInterface,
  routesFor,
  selectInterfaces,
  type SendRoute,
} from '../../domain/network';
import type { NetworkInterfaces } from '../ports';
import type { RoomsRepo } from '../rooms/rooms-service';
import type { SettingsService } from '../settings/settings-service';

export interface InterfacePreview {
  name: string;
  address: string;
  prefixLength: number;
  gateway: string | null;
  mac: string;
  selected: boolean;
  /** Why an interface is not used (pt-BR), null when selected. */
  reason: string | null;
}

export interface NetworkPreview {
  interfaces: InterfacePreview[];
  ports: number[];
  repeat: number;
  /** Every wake: from each selected interface to these destinations. */
  destinations: SendRoute[];
  /** Rooms on routed subnets add their directed broadcast. */
  rooms: { roomId: number; name: string; destinations: SendRoute[] }[];
}

function reasonFor(i: NetInterface, configured: readonly string[]): string {
  if (i.internal || isLoopback(i.address)) return 'interface interna (loopback)';
  if (isApipa(i.address)) return 'sem endereço válido (169.254.x.x, sem DHCP)';
  if (configured.length > 0) return 'não está na lista de interfaces configuradas';
  return 'sem gateway padrão (virtual, VPN ou rede isolada)';
}

export class NetworkPreviewService {
  constructor(
    private readonly d: {
      interfaces: NetworkInterfaces;
      settings: SettingsService;
      rooms: Pick<RoomsRepo, 'list'>;
    },
  ) {}

  async preview(): Promise<NetworkPreview> {
    const all = await this.d.interfaces.list();
    const configured = this.d.settings.get('wake.interfaces');
    const selected = selectInterfaces(all, configured);
    const isSelected = new Set(selected.map((i) => i.address));
    return {
      interfaces: all.map((i) => ({
        name: i.name,
        address: i.address,
        prefixLength: i.prefixLength,
        gateway: i.gateway,
        mac: i.mac,
        selected: isSelected.has(i.address),
        reason: isSelected.has(i.address) ? null : reasonFor(i, configured),
      })),
      ports: [...this.d.settings.get('wake.ports')],
      repeat: this.d.settings.get('wake.repeat'),
      destinations: routesFor(selected, null),
      rooms: this.d.rooms
        .list()
        .filter((r) => r.directedBroadcast)
        .map((r) => ({
          roomId: r.id,
          name: r.name,
          destinations: routesFor(selected, r.directedBroadcast).filter(
            (x) => x.destination === r.directedBroadcast,
          ),
        })),
    };
  }
}
