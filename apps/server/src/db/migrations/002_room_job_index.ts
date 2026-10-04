/** Dashboard "last action per room" looks up the latest job per room (M4-T08). */
export const sql = /* sql */ `
CREATE INDEX wake_job_devices_room_job ON wake_job_devices(room_id, job_id);
`;
