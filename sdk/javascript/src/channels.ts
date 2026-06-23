export function channelForUser(orgId: number, keycloakSub: string): string {
  return `org:${orgId}:user:${keycloakSub}`;
}

export function channelForWorkspace(orgId: number, workspaceId: number): string {
  return `org:${orgId}:ws:${workspaceId}`;
}

export function channelNamed(orgId: number, workspaceId: number, name: string): string {
  return `org:${orgId}:ws:${workspaceId}:channel:${name}`;
}
