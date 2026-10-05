/** "Testar WoL desta máquina" runs and their results for diagnostics (FR-007.4, M7-T08). */
export const sql = /* sql */ `
CREATE TABLE test_wol_runs (
  id           INTEGER PRIMARY KEY,
  device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  state        TEXT    NOT NULL CHECK (state IN ('aguardando_desligar', 'aguardando_placa',
                 'aguardando_ligar', 'sucesso', 'nao_acordou', 'cancelado', 'falhou')),
  requested_by INTEGER,
  started_at   INTEGER NOT NULL,
  offline_at   INTEGER,
  sent_at      INTEGER,
  finished_at  INTEGER,
  job_id       INTEGER REFERENCES wake_jobs(id) ON DELETE SET NULL,
  detail       TEXT
);
CREATE INDEX test_wol_runs_device ON test_wol_runs(device_id, started_at);
CREATE INDEX test_wol_runs_job ON test_wol_runs(job_id);
`;
