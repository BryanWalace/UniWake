import { describe, expect, it } from 'vitest';
import { ouiLines } from '../scripts/update-oui';

describe('bundled MAC vendor list (FR-101, NFR-05)', () => {
  it('keeps MA-L assignments, normalizes names and sorts by prefix', () => {
    const csv = [
      'Registry,Assignment,Organization Name,Organization Address',
      'MA-L,286FB9,"Nokia Shanghai Bell Co., Ltd.","No.388 Ning Qiao Road"',
      'MA-M,70B3D5A,Small Vendor,Somewhere',
      'MA-L,08002 7,Broken,X',
      'MA-L,080027,PCS  Systemtechnik   GmbH,Muenchen',
    ].join('\n');
    expect(ouiLines(csv)).toEqual([
      '080027\tPCS Systemtechnik GmbH',
      '286FB9\tNokia Shanghai Bell Co., Ltd.',
    ]);
  });
});
