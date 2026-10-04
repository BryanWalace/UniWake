/**
 * Dry-run sender (FR-003.7, constitution §2.5): records what would be sent, touches no network.
 * Keeps only the most recent entries in memory; the packet log in the DB is the durable record.
 */
import type { PacketSender, PacketSendRequest } from '../application/ports';

export interface RecordedPacket {
  sourceIp: string;
  destination: string;
  port: number;
  bytes: number;
}

export class RecordingPacketSender implements PacketSender {
  readonly recent: RecordedPacket[] = [];
  count = 0;

  constructor(private readonly keep = 1000) {}

  send(req: PacketSendRequest): Promise<void> {
    this.count++;
    this.recent.push({
      sourceIp: req.sourceIp,
      destination: req.destination,
      port: req.port,
      bytes: req.payload.length,
    });
    if (this.recent.length > this.keep) this.recent.splice(0, this.recent.length - this.keep);
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
