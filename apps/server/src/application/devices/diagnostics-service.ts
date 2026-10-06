/**
 * Device diagnostics (FR-010): wake history, network reachability from this computer, the last
 * "Testar WoL" and the preparation results, summed up as problems with a next step and a help page
 * (FR-007.5).
 */
import {
  type Device,
  type DeviceDiagnostics,
  type DiagnosticProblem,
  isLocallyAdministered,
  type TestWolRun,
} from '@uniwake/shared';
import { routesFor, sameSubnet, selectInterfaces } from '../../domain/network';
import { type VerifiedResult, wakeStats } from '../../domain/wake-stats';
import { AppError } from '../errors';
import type { NetworkInterfaces } from '../ports';
import type { SettingsService } from '../settings/settings-service';

export interface DiagnosticsRepo {
  /** Verified results (acordou / não respondeu) of the device's wakes, newest first. */
  verifiedResults(deviceId: number, limit: number): VerifiedResult[];
  prepareResults(deviceId: number): Record<string, string> | null;
}

export interface DiagnosticsDeps {
  repo: DiagnosticsRepo;
  device: (id: number) => Device | undefined;
  roomBroadcast: (roomId: number) => string | null;
  lastTestWol: (deviceId: number) => TestWolRun | null;
  interfaces: NetworkInterfaces;
  settings: SettingsService;
}

export class DiagnosticsService {
  constructor(private readonly d: DiagnosticsDeps) {}

  async get(deviceId: number): Promise<DeviceDiagnostics> {
    const device = this.d.device(deviceId);
    if (!device) throw new AppError('NOT_FOUND');
    const wake = wakeStats(this.d.repo.verifiedResults(deviceId, 100));
    const selected = selectInterfaces(
      await this.d.interfaces.list(),
      this.d.settings.get('wake.interfaces'),
    );
    const broadcast = device.roomId !== null ? this.d.roomBroadcast(device.roomId) : null;
    const ip = device.ip;
    const same =
      ip === null || selected.length === 0
        ? null
        : selected.some((i) => sameSubnet(ip, i.address, i.prefixLength));

    const problems: DiagnosticProblem[] = [];
    if (wake.stoppedWaking) {
      problems.push({
        code: 'parou_de_acordar',
        title: 'Parou de acordar',
        message: `Ligava pela rede, mas não respondeu às últimas ${wake.consecutiveFailures} tentativas. Costuma ser uma atualização do Windows que reativou a Inicialização Rápida ou mudou a energia da placa de rede: execute a preparação de novo.`,
        help: 'fast-startup',
      });
    }
    if (device.enabled && !device.everOnline) {
      problems.push({
        code: 'nunca_respondeu',
        title: 'Nunca respondeu',
        message:
          'Esta máquina nunca respondeu às verificações. Se ela estiver ligada, o firewall do Windows provavelmente bloqueia ping (ICMP) e as portas 135, 445 e 3389.',
        help: 'firewall-icmp',
      });
    }
    if (selected.length === 0) {
      problems.push({
        code: 'sem_interface',
        title: 'Sem placa de rede para enviar',
        message:
          'Este computador do UniWake não tem uma placa de rede com gateway para enviar o Magic Packet. Verifique o cabo e a rede, ou escolha as placas em Configurações.',
        help: 'vlan-broadcast',
      });
    } else if (same === false && !broadcast) {
      problems.push({
        code: 'outra_subrede',
        title: 'Dispositivo em outra sub-rede',
        message: `O IP ${ip} não está na rede de nenhuma placa do UniWake (${selected.map((i) => `${i.address}/${i.prefixLength}`).join(', ')}). O broadcast não atravessa roteadores: configure o broadcast dirigido da sala ou peça à TI para encaminhá-lo.`,
        help: 'vlan-broadcast',
      });
    }
    if (isLocallyAdministered(device.mac)) {
      problems.push({
        code: 'mac_virtual',
        title: 'MAC de Wi-Fi, virtual ou aleatório',
        message:
          'Wake-on-LAN costuma funcionar só pela placa de rede cabeada. Use o MAC dela (a preparação da máquina informa).',
        help: 'nic-power',
      });
    }

    return {
      deviceId,
      problems,
      mac: device.mac,
      macLocallyAdministered: isLocallyAdministered(device.mac),
      otherMacs: device.otherMacs,
      wake,
      network: {
        deviceIp: ip,
        interfaces: selected.map((i) => ({
          name: i.name,
          address: i.address,
          prefixLength: i.prefixLength,
        })),
        sameSubnet: same,
        destinations: routesFor(selected, broadcast),
      },
      lastTestWol: this.d.lastTestWol(deviceId),
      prepare: {
        preparedAt: device.preparedAt,
        enrolledAt: device.enrolledAt,
        results: this.d.repo.prepareResults(deviceId),
      },
    };
  }
}
