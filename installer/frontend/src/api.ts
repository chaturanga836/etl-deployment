const API = '/api';

export type Prerequisites = {
  docker: { available: boolean; version: string | null };
  compose: { available: boolean; version: string | null };
  helm: { available: boolean; version: string | null };
  kubectl: { available: boolean; version: string | null };
};

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
    source: 'bundled' | 'external';
    host: string;
    port: number;
    user: string;
    password: string;
    metadata_db_name: string;
    workspace_db_name: string;
    keycloak_db_name: string;
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

export const defaultWizard: WizardState = {
  deployment_mode: 'monolith',
  registry_url: 'ghcr.io/YOUR_GITHUB_ORG',
  image_tag: 'v1.0.0',
  app_name: 'DT Orch',
  superadmin_username: '',
  superadmin_password: '',
  superadmin_email: '',
  license_key: '',
  database: {
    source: 'bundled',
    host: '',
    port: 5432,
    user: 'elt',
    password: '',
    metadata_db_name: 'dtorc_metadata',
    workspace_db_name: 'dtorc_workspace',
    keycloak_db_name: 'keycloak',
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

export async function validateLicense(key: string) {
  const r = await fetch(`${API}/validate/license`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (!r.ok) {
    const err = await r.json();
    throw new Error(err.detail || 'Invalid license');
  }
  return r.json();
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
      license_key: wizard.license_key,
      database: wizard.database,
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

export async function fetchInstallState() {
  const r = await fetch(`${API}/install-state`);
  return r.json();
}
