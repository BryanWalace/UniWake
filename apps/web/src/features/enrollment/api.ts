/** "Preparar máquinas": enrollment tokens, hub addresses and the one-line command (FR-007.3). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatedEnrollmentToken,
  EnrollmentAddresses,
  EnrollmentCommand,
  EnrollmentToken,
  EnrollmentTokenCreate,
} from '@uniwake/shared';
import { api } from '../../api/client';

export const enrollmentKeys = {
  tokens: ['enrollment', 'tokens'] as const,
  addresses: ['enrollment', 'addresses'] as const,
};

export function useEnrollmentTokens() {
  return useQuery({
    queryKey: enrollmentKeys.tokens,
    queryFn: () => api.get<EnrollmentToken[]>('/api/enrollment/tokens'),
  });
}

export function useEnrollmentAddresses() {
  return useQuery({
    queryKey: enrollmentKeys.addresses,
    queryFn: () => api.get<EnrollmentAddresses>('/api/enrollment/addresses'),
  });
}

export function useCreateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: EnrollmentTokenCreate) =>
      api.post<CreatedEnrollmentToken>('/api/enrollment/tokens', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: enrollmentKeys.tokens }),
  });
}

export function useRevokeToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api.post<EnrollmentToken>(`/api/enrollment/tokens/${id}/revoke`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: enrollmentKeys.tokens }),
  });
}

/**
 * The one-liner for a token shown moments ago and a chosen address. Built once per pair: the hub
 * audits each build and remembers the address, so it is never refetched in the background.
 */
export function useEnrollmentCommand(token: string, address: string | null) {
  return useQuery({
    queryKey: ['enrollment', 'command', token, address] as const,
    queryFn: () => api.post<EnrollmentCommand>('/api/enrollment/command', { token, address }),
    enabled: address !== null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}
