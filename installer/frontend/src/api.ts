const API = '/api';

export const ACTIVE_JOB_STORAGE_KEY = 'dt-orch-installer-job-id';
export const ACTIVE_JOB_KIND_STORAGE_KEY = 'dt-orch-installer-job-kind';

export type Prerequisites = {
  docker: { available: boolean; version: string | null };
  compose: { available: boolean; version: string | null };
  helm: { available: boolean; version: string | null };
  kubectl: { available: boolean; version: string | null };
  registry?: {
    url: string;
    api_image: string;
    images?: Record<string, { image: string; accessible: boolean; error: string | null }>;
    accessible: boolean | null;
    public: boolean;
    error: string | null;
    local_build: boolean;
  };
};

export type InstallDefaults = {
  app_name: string;
  platform_version: string;
  registry_url: string;
  image_tag: string;
  components: { id: string; label: string }[];
  end_user_managed: boolean;
  registry_public: boolean;
  description: string;
};

export type HostInfo = {
  public_ipv4: string | null;
  public_dns: string | null;
  local_hostname: string;
  suggested_public_host: string;
  installer_port: number;
  platform_http_port: number;
  installer_url: string;
  platform_url: string;
  security_group_ports: number[];
};

export type ServiceSource = 'bundled' | 'external';

export type WizardState = {
  deployment_mode: 'monolith' | 'distributed' | 'kubernetes';
  registry_url: string;
  image_tag: string;
  app_name: string;
  superadmin_username: string;
  superadmin_password: string;
  superadmin_email: string;
  license_key: string;
  database: {
    source: ServiceSource;
    host: string;
    port: number;
    user: string;
    password: string;
    metadata_db_name: string;
    workspace_db_name: string;
    keycloak_db_name: string;
  };
  keycloak: {
    source: ServiceSource;
    host: string;
    port: number;
    admin_user: string;
    admin_password: string;
    realm: string;
    admin_client_id: string;
    admin_client_secret: string;
  };
  redis: {
    source: ServiceSource;
    host: string;
    port: number;
    password: string;
  };
  minio: {
    source: ServiceSource;
    host: string;
    port: number;
    access_key: string;
    secret_key: string;
    bucket: string;
  };
  centrifugo: {
    source: ServiceSource;
    host: string;
    http_port: number;
    api_key: string;
    token_hmac_secret_key: string;
  };
  monolith: {
    public_host: string;
    use_proxy: boolean;
    http_port: number;
  };
  distributed: {
    services: Record<string, { host?: string; port?: number; replicas?: number }>;
  };
  kubernetes: {
    namespace: string;
    ingress_host: string;
    kubeconfig_path: string;
  };
  ssh: {
    user: string;
    key_path: string;
    remote_path: string;
  };
};

function randomSecret(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i += 1) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const defaultWizard: WizardState = {
  deployment_mode: 'monolith',
  registry_url: 'ghcr.io/chaturanga836',
  image_tag: 'v1.0.0',
  app_name: 'DT Orch',
  superadmin_username: '',
  superadmin_password: '',
  superadmin_email: '',
  license_key: '',
  database: {
    source: 'bundled',
    host: 'postgres',
    port: 5432,
    user: 'elt',
    password: '',
    metadata_db_name: 'dtorc_metadata',
    workspace_db_name: 'dtorc_workspace',
    keycloak_db_name: 'keycloak',
  },
  keycloak: {
    source: 'bundled',
    host: 'localhost',
    port: 8081,
    admin_user: 'admin',
    admin_password: 'changeme',
    realm: 'workspace-realm',
    admin_client_id: 'workspace-api',
    admin_client_secret: 'changeme-api-secret',
  },
  redis: {
    source: 'bundled',
    host: 'redis',
    port: 6379,
    password: '',
  },
  minio: {
    source: 'bundled',
    host: 'platform-shared-minio-storage',
    port: 9000,
    access_key: `minio${randomSecret(4)}`,
    secret_key: randomSecret(24),
    bucket: 'data',
  },
  centrifugo: {
    source: 'bundled',
    host: 'centrifugo',
    http_port: 8000,
    api_key: randomSecret(24),
    token_hmac_secret_key: randomSecret(32),
  },
  monolith: {
    public_host: 'localhost',
    use_proxy: true,
    http_port: 80,
  },
  distributed: {
    services: {
      frontend: { host: '10.0.1.10', port: 443 },
      backend: { host: '10.0.2.20', port: 8000 },
      worker: { host: '10.0.2.21', replicas: 1 },
      auth: { host: '10.0.3.30', port: 8081 },
      infra: { host: '10.0.2.22', port: 9000 },
      redis: { host: '10.0.2.23', port: 6379 },
    },
  },
  kubernetes: {
    namespace: 'dt-orch',
    ingress_host: 'studio.example.com',
    kubeconfig_path: '',
  },
  ssh: {
    user: 'ubuntu',
    key_path: '',
    remote_path: '/opt/etl-deployment',
  },
};

export async function fetchInstallDefaults(): Promise<InstallDefaults> {
  const r = await fetch(`${API}/install-defaults`);
  return r.json();
}

export async function fetchHostInfo(): Promise<HostInfo> {
  const r = await fetch(`${API}/host-info`);
  return r.json();
}

export async function fetchPrerequisites(): Promise<Prerequisites> {
  const r = await fetch(`${API}/prerequisites`);
  return r.json();
}

export async function validateDatabase(body: WizardState['database']) {
  const r = await fetch(`${API}/validate/database`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: body.host,
      port: body.port,
      user: body.user,
      password: body.password,
      database: 'postgres',
    }),
  });
  if (!r.ok) {
    const err = await r.json();
    throw new Error(err.detail || 'Connection failed');
  }
}

export async function startDeploy(wizard: WizardState): Promise<string> {
  const r = await fetch(`${API}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deployment_mode: wizard.deployment_mode,
      registry_url: wizard.registry_url,
      image_tag: wizard.image_tag,
      app_name: wizard.app_name,
      superadmin_username: wizard.superadmin_username,
      superadmin_password: wizard.superadmin_password,
      superadmin_email: wizard.superadmin_email || undefined,
      license_key: '',
      database: wizard.database,
      keycloak: wizard.keycloak,
      redis: wizard.redis,
      minio: wizard.minio,
      centrifugo: wizard.centrifugo,
      kc_admin_user: wizard.keycloak.admin_user,
      kc_admin_password: wizard.keycloak.admin_password,
      kc_realm: wizard.keycloak.realm,
      monolith: wizard.monolith,
      distributed: wizard.distributed,
      kubernetes: wizard.kubernetes,
      ssh: wizard.ssh,
    }),
  });
  if (!r.ok) {
    const err = await r.json();
    throw new Error(err.detail || 'Deploy failed to start');
  }
  const data = await r.json();
  return data.job_id as string;
}

export type UpgradeInfo = {
  installed: boolean;
  current_tag?: string;
  available_tag?: string;
  platform_version?: string;
  upgrade_available?: boolean;
  login_url?: string | null;
};

export async function fetchUpgradeInfo(): Promise<UpgradeInfo> {
  const r = await fetch(`${API}/upgrade-info`);
  return r.json();
}

export async function startUpgrade(): Promise<string> {
  const r = await fetch(`${API}/upgrade`, { method: 'POST' });
  if (!r.ok) {
    const err = await r.json();
    throw new Error(err.detail || 'Upgrade failed to start');
  }
  const data = await r.json();
  return data.job_id as string;
}

export async function fetchSupportReport(): Promise<Record<string, unknown>> {
  const r = await fetch(`${API}/support-report`);
  return r.json();
}

export async function fetchInstallState() {
  const r = await fetch(`${API}/install-state`);
  return r.json();
}

export type DeployPhase = {
  key: string;
  label: string;
  progress: number;
};

export type DeployJobSnapshot = {
  active?: boolean;
  job_id: string;
  kind: 'deploy' | 'upgrade';
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  login_url: string | null;
  error: string | null;
  phase: DeployPhase | null;
  logs: string[];
};

export async function fetchActiveDeployJob(): Promise<DeployJobSnapshot | null> {
  const r = await fetch(`${API}/deploy/active`);
  const data = await r.json();
  if (!data.active) {
    return null;
  }
  return data as DeployJobSnapshot;
}

export async function fetchDeployStatus(jobId: string): Promise<DeployJobSnapshot> {
  const r = await fetch(`${API}/deploy/${jobId}/status`);
  if (!r.ok) {
    throw new Error('Job not found');
  }
  return r.json();
}

export function persistActiveJob(jobId: string, kind: 'deploy' | 'upgrade') {
  sessionStorage.setItem(ACTIVE_JOB_STORAGE_KEY, jobId);
  sessionStorage.setItem(ACTIVE_JOB_KIND_STORAGE_KEY, kind);
}

export function clearActiveJob() {
  sessionStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
  sessionStorage.removeItem(ACTIVE_JOB_KIND_STORAGE_KEY);
}
