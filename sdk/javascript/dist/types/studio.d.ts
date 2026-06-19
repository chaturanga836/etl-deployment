export type ProjectCredentialsCreated = {
    client_key: string;
    client_secret: string;
};
export type ProjectCredentialsMeta = {
    client_key: string;
    secret_prefix: string;
    created_at?: string | null;
    rotated_at?: string | null;
};
export type ProjectSummary = {
    project_id: number;
    org_id: number;
    name: string;
    slug: string;
    description?: string | null;
    status: string;
    region?: string | null;
    settings: Record<string, unknown>;
    created_at?: string | null;
    credentials?: ProjectCredentialsCreated | null;
    credentials_meta?: ProjectCredentialsMeta | null;
};
export type ProjectListResponse = {
    items: ProjectSummary[];
    total: number;
};
export type AccountResponse = {
    user: {
        id: number;
        email: string;
        role: string;
    };
    organization: {
        id: number;
        name: string;
        slug: string;
    };
    realm_roles: string[];
    is_super_admin: boolean;
    project_ids: number[];
};
