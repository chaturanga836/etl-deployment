"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.channelForUser = channelForUser;
exports.channelForWorkspace = channelForWorkspace;
exports.channelNamed = channelNamed;
function channelForUser(orgId, keycloakSub) {
    return `org:${orgId}:user:${keycloakSub}`;
}
function channelForWorkspace(orgId, workspaceId) {
    return `org:${orgId}:ws:${workspaceId}`;
}
function channelNamed(orgId, workspaceId, name) {
    return `org:${orgId}:ws:${workspaceId}:channel:${name}`;
}
