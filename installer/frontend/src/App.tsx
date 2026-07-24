import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Progress,
  Button,
  Card,
  Collapse,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Layout,
  Radio,
  Result,
  Space,
  Steps,
  Typography,
  message,
} from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import {
  ACTIVE_JOB_STORAGE_KEY,
  clearActiveJob,
  defaultWizard,
  fetchActiveDeployJob,
  fetchDeployStatus,
  fetchHostInfo,
  fetchInstallDefaults,
  fetchInstallState,
  fetchPrerequisites,
  fetchSupportReport,
  fetchUpgradeInfo,
  persistActiveJob,
  startDeploy,
  startUpgrade,
  validateDatabase,
  type DeployJobSnapshot,
  type HostInfo,
  type InstallDefaults,
  type Prerequisites,
  type ServiceSource,
  type UpgradeInfo,
  type WizardState,
} from './api';
import { useDeployEvents } from './useDeployEvents';
import InstallerBrand from './components/InstallerBrand';
import { BRAND_NAME } from './constants/brand';
import './App.css';

const { Header, Content, Sider } = Layout;
const { Paragraph, Text, Link } = Typography;

const MIN_USERNAME_LENGTH = 3;
const MIN_PASSWORD_LENGTH = 8;

/** User-visible step labels (matches internal step indices 0–13). */
const STEP_LABELS = [
  'Welcome',
  'Type',
  'Database',
  'MongoDB',
  'Keycloak',
  'Redis',
  'MinIO',
  'Centrifugo',
  'Grafana',
  'Account',
  'Website',
  'Confirm',
  'Installing',
  'Done',
];

const LAST_FORM_STEP = 11;
const INSTALLING_STEP = 12;
const DONE_STEP = 13;

function isAccountStepValid(wizard: WizardState): boolean {
  return (
    wizard.superadmin_username.trim().length >= MIN_USERNAME_LENGTH
    && wizard.superadmin_password.length >= MIN_PASSWORD_LENGTH
  );
}

function isDatabaseStepValid(wizard: WizardState, dbValidated: boolean): boolean {
  const ws = wizard.workspace_sql;
  if (!ws.host.trim() || !ws.user.trim()) return false;
  if (ws.source === 'external') {
    return Boolean(ws.password) && dbValidated;
  }
  return true;
}

function isMongoStepValid(wizard: WizardState): boolean {
  if (wizard.mongo.source === 'skip' || wizard.mongo.source === 'bundled') return true;
  return Boolean(wizard.mongo.host.trim() && wizard.mongo.port && wizard.mongo.user.trim());
}

function isKeycloakStepValid(wizard: WizardState): boolean {
  const k = wizard.keycloak;
  return Boolean(
    k.host.trim()
    && k.port
    && k.admin_user.trim()
    && k.admin_password
    && k.realm.trim()
    && k.admin_client_id.trim()
    && k.admin_client_secret.trim(),
  );
}

function isRedisStepValid(wizard: WizardState): boolean {
  return Boolean(wizard.redis.host.trim() && wizard.redis.port);
}

function isMinioStepValid(wizard: WizardState): boolean {
  const m = wizard.minio;
  return Boolean(m.host.trim() && m.port && m.access_key.trim() && m.secret_key.trim() && m.bucket.trim());
}

function isCentrifugoStepValid(wizard: WizardState): boolean {
  const c = wizard.centrifugo;
  return Boolean(c.host.trim() && c.http_port && c.api_key.trim() && c.token_hmac_secret_key.trim());
}

function isGrafanaStepValid(wizard: WizardState): boolean {
  const g = wizard.grafana;
  if (g.source === 'skip') return true;
  if (g.source === 'bundled') {
    return Boolean(g.port && g.admin_user.trim() && g.admin_password.length >= 8);
  }
  const url = g.url.trim();
  return Boolean(url) && (url.startsWith('http://') || url.startsWith('https://'));
}

function isWebsiteStepValid(wizard: WizardState): boolean {
  const host = wizard.monolith.public_host.trim();
  // Reject emails mistaken for a hostname (e.g. user@gmail.com).
  return host.length > 0 && !host.includes('@');
}

function SourceRadios({
  value,
  onChange,
  bundledLabel = 'Install for me',
  bundledHint = 'Recommended for a new server.',
  externalLabel = 'Use existing',
}: {
  value: ServiceSource;
  onChange: (v: ServiceSource) => void;
  bundledLabel?: string;
  bundledHint?: string;
  externalLabel?: string;
}) {
  return (
    <Radio.Group
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ marginBottom: 16 }}
    >
      <Space direction="vertical">
        <Radio value="bundled">
          <Text strong>{bundledLabel}</Text>
          <br />
          <Text type="secondary">{bundledHint}</Text>
        </Radio>
        <Radio value="external">
          <Text strong>{externalLabel}</Text>
        </Radio>
      </Space>
    </Radio.Group>
  );
}

export default function App() {
  const [step, setStep] = useState(0);
  const [wizard, setWizard] = useState<WizardState>(defaultWizard);
  const [prereqs, setPrereqs] = useState<Prerequisites | null>(null);
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [installDefaults, setInstallDefaults] = useState<InstallDefaults | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [loginUrl, setLoginUrl] = useState('');
  const [deployError, setDeployError] = useState('');
  const [alreadyInstalled, setAlreadyInstalled] = useState<{ login_url?: string } | null>(null);
  const [upgradeInfo, setUpgradeInfo] = useState<UpgradeInfo | null>(null);
  const [jobKind, setJobKind] = useState<'deploy' | 'upgrade'>('deploy');
  const [prereqsLoading, setPrereqsLoading] = useState(true);
  const [dbValidated, setDbValidated] = useState(false);
  const [accountTouched, setAccountTouched] = useState(false);

  const update = (partial: Partial<WizardState>) => {
    setWizard((w) => ({ ...w, ...partial }));
  };

  const refreshPrereqs = useCallback(async () => {
    setPrereqsLoading(true);
    try {
      setPrereqs(await fetchPrerequisites());
    } catch {
      message.error('Could not run system check');
    } finally {
      setPrereqsLoading(false);
    }
  }, []);

  const onComplete = useCallback((url: string) => {
    clearActiveJob();
    setLoginUrl(url);
    setStep(DONE_STEP);
    fetchUpgradeInfo().then(setUpgradeInfo).catch(() => {});
  }, []);
  const onError = useCallback((msg: string) => {
    setDeployError(msg);
    message.error(msg);
  }, []);

  const copySupportReport = useCallback(async () => {
    try {
      const report = await fetchSupportReport();
      const text = JSON.stringify(report, null, 2);
      await navigator.clipboard.writeText(text);
      message.success('Support report copied — send it to your vendor');
    } catch {
      message.error('Could not copy support report');
    }
  }, []);

  const { logs, phase, bottomRef } = useDeployEvents(jobId, onComplete, onError);

  const resumeDeployJob = useCallback((snapshot: DeployJobSnapshot) => {
    setJobId(snapshot.job_id);
    setJobKind(snapshot.kind === 'upgrade' ? 'upgrade' : 'deploy');
    setStep(INSTALLING_STEP);
    setDeployError(snapshot.status === 'failed' ? snapshot.error || 'Installation failed' : '');
    persistActiveJob(snapshot.job_id, snapshot.kind);
  }, []);

  useEffect(() => {
    const load = async () => {
      setPrereqsLoading(true);
      try {
        setPrereqs(await fetchPrerequisites());
      } catch {
        /* welcome step still shows a checking/not-found state */
      } finally {
        setPrereqsLoading(false);
      }
      fetchInstallDefaults().then((defaults) => {
        setInstallDefaults(defaults);
        setWizard((w) => ({
          ...w,
          registry_url: defaults.registry_url,
          image_tag: defaults.image_tag,
          app_name: defaults.app_name,
        }));
      }).catch(() => {});
      fetchHostInfo().then((info) => {
        setHostInfo(info);
        setWizard((w) => ({
          ...w,
          monolith: {
            ...w.monolith,
            public_host: w.monolith.public_host === 'localhost'
              ? info.suggested_public_host
              : w.monolith.public_host,
          },
          keycloak: {
            ...w.keycloak,
            host: w.keycloak.host === 'localhost'
              ? info.suggested_public_host
              : w.keycloak.host,
          },
          centrifugo: {
            ...w.centrifugo,
            host: w.centrifugo.host === 'localhost'
              ? info.suggested_public_host
              : w.centrifugo.host,
          },
          kubernetes: {
            ...w.kubernetes,
            ingress_host: w.kubernetes.ingress_host === 'studio.example.com'
              ? info.suggested_public_host
              : w.kubernetes.ingress_host,
          },
        }));
      }).catch(() => {});

      const installState = await fetchInstallState().catch(() => ({ installed: false }));
      if (installState.installed) {
        setAlreadyInstalled(installState);
        setLoginUrl(installState.login_url || '');
        setStep(DONE_STEP);
        return;
      }

      const upgradeInfoResult = await fetchUpgradeInfo().catch(() => null);
      if (upgradeInfoResult) setUpgradeInfo(upgradeInfoResult);

      const storedJobId = sessionStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
      if (storedJobId) {
        try {
          const status = await fetchDeployStatus(storedJobId);
          if (status.status === 'running' || status.status === 'pending') {
            resumeDeployJob(status);
            return;
          }
          if (status.status === 'succeeded' && status.login_url) {
            clearActiveJob();
            setLoginUrl(status.login_url);
            setStep(DONE_STEP);
            return;
          }
          clearActiveJob();
        } catch {
          clearActiveJob();
        }
      }

      const active = await fetchActiveDeployJob().catch(() => null);
      if (active && (active.status === 'running' || active.status === 'pending')) {
        resumeDeployJob(active);
      }
    };
    void load();
  }, [resumeDeployJob]);

  const next = async () => {
    if (step === 2 && !isDatabaseStepValid(wizard, dbValidated)) {
      if (wizard.workspace_sql.source === 'external') {
        message.warning('Fill in database connection details and click Test connection before continuing.');
      } else {
        message.warning('Enter database host, port, and username before continuing.');
      }
      return;
    }
    if (step === 3 && !isMongoStepValid(wizard)) {
      message.warning('Fill in MongoDB connection details or choose Skip / Install for me.');
      return;
    }
    if (step === 4 && !isKeycloakStepValid(wizard)) {
      message.warning('Fill in all Keycloak fields before continuing.');
      return;
    }
    if (step === 5 && !isRedisStepValid(wizard)) {
      message.warning('Enter Redis host and port before continuing.');
      return;
    }
    if (step === 6 && !isMinioStepValid(wizard)) {
      message.warning('Fill in all MinIO fields before continuing.');
      return;
    }
    if (step === 7 && !isCentrifugoStepValid(wizard)) {
      message.warning('Fill in all Centrifugo fields before continuing.');
      return;
    }
    if (step === 8 && !isGrafanaStepValid(wizard)) {
      if (wizard.grafana.source === 'external') {
        message.warning('Enter a full Grafana URL (http://… or https://…).');
      } else {
        message.warning('Set Grafana port and an admin password (8+ characters).');
      }
      return;
    }
    if (step === 9 && !isAccountStepValid(wizard)) {
      message.warning(
        `Enter a username (${MIN_USERNAME_LENGTH}+ characters) and password (${MIN_PASSWORD_LENGTH}+ characters).`,
      );
      return;
    }
    if (step === 10 && wizard.deployment_mode === 'monolith' && !isWebsiteStepValid(wizard)) {
      message.warning('Enter the website address people will use to open DT Orch.');
      return;
    }
    if (step === INSTALLING_STEP) return;
    setStep((s) => Math.min(s + 1, DONE_STEP));
  };

  const nextDisabled = (
    (step === 2 && !isDatabaseStepValid(wizard, dbValidated))
    || (step === 3 && !isMongoStepValid(wizard))
    || (step === 4 && !isKeycloakStepValid(wizard))
    || (step === 5 && !isRedisStepValid(wizard))
    || (step === 6 && !isMinioStepValid(wizard))
    || (step === 7 && !isCentrifugoStepValid(wizard))
    || (step === 8 && !isGrafanaStepValid(wizard))
    || (step === 9 && !isAccountStepValid(wizard))
    || (step === 10 && wizard.deployment_mode === 'monolith' && !isWebsiteStepValid(wizard))
  );

  const back = () => setStep((s) => Math.max(0, s - 1));

  const goToStep = (index: number) => {
    if (index < 0 || index > step) return;
    if (step >= INSTALLING_STEP && index < INSTALLING_STEP) return;
    setStep(index);
  };

  const runDeploy = async () => {
    setDeployError('');
    setJobKind('deploy');
    try {
      const id = await startDeploy(wizard);
      persistActiveJob(id, 'deploy');
      setJobId(id);
      setStep(INSTALLING_STEP);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Install failed');
    }
  };

  const runUpgrade = async () => {
    setDeployError('');
    setJobKind('upgrade');
    try {
      const id = await startUpgrade();
      persistActiveJob(id, 'upgrade');
      setJobId(id);
      setStep(INSTALLING_STEP);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Upgrade failed');
    }
  };

  const testDb = async () => {
    try {
      await validateDatabase({
        host: wizard.workspace_sql.host,
        port: wizard.workspace_sql.port,
        user: wizard.workspace_sql.user,
        password: wizard.workspace_sql.password,
        engine: wizard.workspace_sql.engine,
        database:
          wizard.workspace_sql.engine === 'mysql'
            ? wizard.workspace_sql.database_name
            : 'postgres',
      });
      setDbValidated(true);
      message.success('Database connection successful');
    } catch (e) {
      setDbValidated(false);
      message.error(e instanceof Error ? e.message : 'Connection failed');
    }
  };

  const siteUrl = hostInfo?.platform_url
    ?? (wizard.monolith.public_host ? `http://${wizard.monolith.public_host}` : '');

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <Card title="Welcome">
            <InstallerBrand variant="hero" showTagline />
            <Paragraph style={{ marginTop: 16 }}>
              This guide will install <Text strong>{BRAND_NAME}</Text>
              {installDefaults ? ` version ${installDefaults.platform_version}` : ''} on this server.
              Answer a few questions, then click <Text strong>Install</Text>.
            </Paragraph>
            {siteUrl && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="After installation"
                description={
                  <Text>
                    You will open your platform at{' '}
                    <Link href={`${siteUrl.replace(/\/$/, '')}/login`} target="_blank" rel="noreferrer">
                      {siteUrl.replace(/\/$/, '')}/login
                    </Link>
                  </Text>
                }
              />
            )}
            {prereqsLoading ? (
              <Alert
                type="info"
                showIcon
                icon={<LoadingOutlined spin />}
                style={{ marginTop: 16 }}
                message="Checking Docker and system requirements…"
              />
            ) : !prereqs?.docker.available ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 16 }}
                message="Docker must be installed on this server before you continue."
                action={
                  <Button size="small" loading={prereqsLoading} onClick={() => void refreshPrereqs()}>
                    Check again
                  </Button>
                }
              />
            ) : null}
            {prereqs?.registry && prereqs.registry.accessible === false && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 16 }}
                message={
                  prereqs.registry.public
                    ? 'Cannot download release images'
                    : 'Registry login required before install'
                }
                description={
                  <Space direction="vertical" size="small">
                    {prereqs.registry.public && prereqs.registry.error === 'denied' && (
                      <Text>
                        DT Orch release images should be publicly downloadable. Contact support if
                        packages are still private on GitHub Container Registry.
                      </Text>
                    )}
                    {prereqs.registry.public && prereqs.registry.error === 'not_found' && (
                      <Text>One or more release images were not found for this version.</Text>
                    )}
                    {prereqs.registry.public && prereqs.registry.error === 'unreachable' && (
                      <Text>
                        Cannot reach <Text code>{prereqs.registry.url}</Text>. Check outbound HTTPS.
                      </Text>
                    )}
                    {!prereqs.registry.public && (
                      <Text>
                        Private registry — log in on the host with a GitHub PAT that has{' '}
                        <Text code>read:packages</Text>.
                      </Text>
                    )}
                    <Text type="secondary">Image: <Text code>{prereqs.registry.api_image}</Text></Text>
                    <Button loading={prereqsLoading} onClick={refreshPrereqs}>
                      Check again
                    </Button>
                  </Space>
                }
              />
            )}
            {prereqs?.registry && prereqs.registry.accessible === true && (
              <Alert
                type="success"
                showIcon
                style={{ marginTop: 16 }}
                message={
                  prereqs.registry.public
                    ? 'Release images available — no GitHub login required'
                    : 'Registry reachable — ready to install'
                }
              />
            )}
            {prereqs && (
              <Collapse
                ghost
                style={{ marginTop: 8 }}
                items={[{
                  key: 'sys',
                  label: 'Technical system check',
                  children: (
                    <Space direction="vertical">
                      <Text>Docker: {prereqs.docker.available ? prereqs.docker.version : 'Not found'}</Text>
                      <Text>Compose: {prereqs.compose.available ? prereqs.compose.version : 'Not found'}</Text>
                    </Space>
                  ),
                }]}
              />
            )}
          </Card>
        );
      case 1:
        return (
          <Card title="How do you want to install?">
            <Radio.Group
              value={wizard.deployment_mode}
              onChange={(e) => update({ deployment_mode: e.target.value })}
            >
              <Space direction="vertical" size="middle">
                <Radio value="monolith">
                  <Text strong>Single server</Text>
                  <br />
                  <Text type="secondary">Recommended — everything on this machine.</Text>
                </Radio>
                <Radio value="distributed" disabled>
                  <Text strong>Multiple servers</Text>
                  <br />
                  <Text type="secondary">For advanced setups (coming soon in this wizard).</Text>
                </Radio>
                <Radio value="kubernetes" disabled>
                  <Text strong>Kubernetes</Text>
                  <br />
                  <Text type="secondary">For advanced setups (coming soon in this wizard).</Text>
                </Radio>
              </Space>
            </Radio.Group>
          </Card>
        );
      case 2:
        return (
          <Card title="Database">
            <Paragraph type="secondary">
              Choose the SQL engine for Studio project databases. Platform metadata Postgres is
              installed automatically in the background (not shown here).
            </Paragraph>
            <Radio.Group
              value={wizard.workspace_sql.engine}
              onChange={(e) => {
                const engine = e.target.value as 'postgres' | 'mysql';
                setDbValidated(false);
                update({
                  // Platform Postgres stays bundled and hidden from the UI.
                  database: {
                    ...wizard.database,
                    source: 'bundled',
                    host: 'postgres',
                    port: 5432,
                  },
                  workspace_sql: {
                    engine,
                    source: 'bundled',
                    host: engine === 'mysql' ? 'mysql' : 'postgres',
                    port: engine === 'mysql' ? 3306 : 5432,
                    user: 'elt',
                    password: '',
                    database_name: 'dtorc_workspace',
                  },
                });
              }}
              style={{ marginBottom: 16 }}
            >
              <Space direction="vertical">
                <Radio value="postgres">
                  <Text strong>PostgreSQL</Text>
                  <br />
                  <Text type="secondary">
                    Studio schemas on shared Postgres (same server as platform metadata).
                  </Text>
                </Radio>
                <Radio value="mysql">
                  <Text strong>MySQL</Text>
                  <br />
                  <Text type="secondary">Studio project databases on shared MySQL.</Text>
                </Radio>
              </Space>
            </Radio.Group>

            <SourceRadios
              value={wizard.workspace_sql.source}
              onChange={(source) => {
                setDbValidated(false);
                const engine = wizard.workspace_sql.engine;
                update({
                  workspace_sql: {
                    ...wizard.workspace_sql,
                    source,
                    host:
                      source === 'bundled'
                        ? (engine === 'mysql' ? 'mysql' : 'postgres')
                        : wizard.workspace_sql.host,
                    port:
                      source === 'bundled'
                        ? (engine === 'mysql' ? 3306 : 5432)
                        : wizard.workspace_sql.port,
                  },
                });
              }}
              bundledLabel={
                wizard.workspace_sql.engine === 'mysql'
                  ? 'Install MySQL for me'
                  : 'Install PostgreSQL for me'
              }
              externalLabel={
                wizard.workspace_sql.engine === 'mysql'
                  ? 'Use existing MySQL'
                  : 'Use existing PostgreSQL'
              }
            />
            <Form layout="vertical">
              <Form.Item label="Host" required>
                <Input
                  value={wizard.workspace_sql.host}
                  onChange={(e) => {
                    setDbValidated(false);
                    update({ workspace_sql: { ...wizard.workspace_sql, host: e.target.value } });
                  }}
                  placeholder={
                    wizard.workspace_sql.source === 'bundled'
                      ? (wizard.workspace_sql.engine === 'mysql' ? 'mysql' : 'postgres')
                      : 'db.example.com'
                  }
                />
              </Form.Item>
              <Form.Item label="Port" required>
                <InputNumber
                  value={wizard.workspace_sql.port}
                  onChange={(v) => {
                    setDbValidated(false);
                    update({
                      workspace_sql: {
                        ...wizard.workspace_sql,
                        port: v || (wizard.workspace_sql.engine === 'mysql' ? 3306 : 5432),
                      },
                    });
                  }}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item label="Username" required>
                <Input
                  value={wizard.workspace_sql.user}
                  onChange={(e) => update({ workspace_sql: { ...wizard.workspace_sql, user: e.target.value } })}
                />
              </Form.Item>
              <Form.Item
                label="Password"
                required={wizard.workspace_sql.source === 'external'}
                extra={
                  wizard.workspace_sql.source === 'bundled'
                    ? 'Leave blank to use the default (changeme).'
                    : undefined
                }
              >
                <Input.Password
                  value={wizard.workspace_sql.password}
                  onChange={(e) => {
                    setDbValidated(false);
                    update({ workspace_sql: { ...wizard.workspace_sql, password: e.target.value } });
                  }}
                />
              </Form.Item>
              <Form.Item
                label="Catalog database"
                extra="Studio project databases (schemas) are created here. Platform system schemas are never shown in Studio."
              >
                <Input
                  value={wizard.workspace_sql.database_name}
                  onChange={(e) => update({ workspace_sql: { ...wizard.workspace_sql, database_name: e.target.value } })}
                />
              </Form.Item>
              {wizard.workspace_sql.source === 'external' && (
                <>
                  <Space>
                    <Button type="primary" onClick={testDb}>Test connection</Button>
                    {dbValidated && <Text type="success">Connection verified</Text>}
                  </Space>
                  {!dbValidated && (
                    <Paragraph type="secondary" style={{ marginTop: 12 }}>
                      Test the connection before continuing.
                    </Paragraph>
                  )}
                </>
              )}
            </Form>
          </Card>
        );
      case 3:
        return (
          <Card title="MongoDB">
            <Paragraph type="secondary">
              Shared MongoDB for the platform (agents and future Studio features). Not used for SQL project schemas.
            </Paragraph>
            <Radio.Group
              value={wizard.mongo.source}
              onChange={(e) => {
                const source = e.target.value as 'bundled' | 'external' | 'skip';
                update({
                  mongo: {
                    ...wizard.mongo,
                    source,
                    host: source === 'bundled' ? 'mongo' : wizard.mongo.host,
                  },
                });
              }}
              style={{ marginBottom: 16 }}
            >
              <Space direction="vertical">
                <Radio value="bundled">
                  <Text strong>Install MongoDB for me</Text>
                </Radio>
                <Radio value="external">
                  <Text strong>Use existing MongoDB</Text>
                </Radio>
                <Radio value="skip">
                  <Text strong>Skip for now</Text>
                </Radio>
              </Space>
            </Radio.Group>
            {wizard.mongo.source !== 'skip' && (
              <Form layout="vertical">
                <Form.Item label="Host" required={wizard.mongo.source === 'external'}>
                  <Input
                    value={wizard.mongo.host}
                    onChange={(e) => update({ mongo: { ...wizard.mongo, host: e.target.value } })}
                    placeholder={wizard.mongo.source === 'bundled' ? 'mongo' : 'mongo.example.com'}
                  />
                </Form.Item>
                <Form.Item label="Port" required>
                  <InputNumber
                    value={wizard.mongo.port}
                    onChange={(v) => update({ mongo: { ...wizard.mongo, port: v || 27017 } })}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
                <Form.Item label="Username">
                  <Input
                    value={wizard.mongo.user}
                    onChange={(e) => update({ mongo: { ...wizard.mongo, user: e.target.value } })}
                  />
                </Form.Item>
                <Form.Item
                  label="Password"
                  extra={wizard.mongo.source === 'bundled' ? 'Leave blank to use the platform DB password default.' : undefined}
                >
                  <Input.Password
                    value={wizard.mongo.password}
                    onChange={(e) => update({ mongo: { ...wizard.mongo, password: e.target.value } })}
                  />
                </Form.Item>
                <Form.Item label="Database name">
                  <Input
                    value={wizard.mongo.database_name}
                    onChange={(e) => update({ mongo: { ...wizard.mongo, database_name: e.target.value } })}
                  />
                </Form.Item>
              </Form>
            )}
          </Card>
        );
      case 4:
        return (
          <Card title="Keycloak">
            <Paragraph type="secondary">
              Auto-filled for a bundled install. Change host, port, or credentials if needed.
            </Paragraph>
            <SourceRadios
              value={wizard.keycloak.source}
              onChange={(source) => update({ keycloak: { ...wizard.keycloak, source } })}
              bundledLabel="Install Keycloak for me"
              externalLabel="Use existing Keycloak"
            />
            <Form layout="vertical">
              <Form.Item label="Host" required>
                <Input
                  value={wizard.keycloak.host}
                  onChange={(e) => update({ keycloak: { ...wizard.keycloak, host: e.target.value } })}
                />
              </Form.Item>
              <Form.Item label="Port" required>
                <InputNumber
                  value={wizard.keycloak.port}
                  onChange={(v) => update({ keycloak: { ...wizard.keycloak, port: v || 8081 } })}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item label="Admin username" required>
                <Input
                  value={wizard.keycloak.admin_user}
                  onChange={(e) => update({ keycloak: { ...wizard.keycloak, admin_user: e.target.value } })}
                />
              </Form.Item>
              <Form.Item label="Admin password" required>
                <Input.Password
                  value={wizard.keycloak.admin_password}
                  onChange={(e) => update({ keycloak: { ...wizard.keycloak, admin_password: e.target.value } })}
                />
              </Form.Item>
              <Form.Item label="Realm" required>
                <Input
                  value={wizard.keycloak.realm}
                  onChange={(e) => update({ keycloak: { ...wizard.keycloak, realm: e.target.value } })}
                />
              </Form.Item>
              <Form.Item label="API client ID" required>
                <Input
                  value={wizard.keycloak.admin_client_id}
                  onChange={(e) => update({ keycloak: { ...wizard.keycloak, admin_client_id: e.target.value } })}
                />
              </Form.Item>
              <Form.Item label="API client secret" required>
                <Input.Password
                  value={wizard.keycloak.admin_client_secret}
                  onChange={(e) => update({ keycloak: { ...wizard.keycloak, admin_client_secret: e.target.value } })}
                />
              </Form.Item>
            </Form>
          </Card>
        );
      case 5:
        return (
          <Card title="Redis">
            <Paragraph type="secondary">
              Used for Celery task queues. Defaults match the bundled Redis container.
            </Paragraph>
            <SourceRadios
              value={wizard.redis.source}
              onChange={(source) => update({
                redis: {
                  ...wizard.redis,
                  source,
                  host: source === 'bundled' ? (wizard.redis.host || 'redis') : wizard.redis.host,
                },
              })}
              bundledLabel="Install Redis for me"
              externalLabel="Use existing Redis"
            />
            <Form layout="vertical">
              <Form.Item label="Host" required>
                <Input
                  value={wizard.redis.host}
                  onChange={(e) => update({ redis: { ...wizard.redis, host: e.target.value } })}
                />
              </Form.Item>
              <Form.Item label="Port" required>
                <InputNumber
                  value={wizard.redis.port}
                  onChange={(v) => update({ redis: { ...wizard.redis, port: v || 6379 } })}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item label="Password (optional)">
                <Input.Password
                  value={wizard.redis.password}
                  onChange={(e) => update({ redis: { ...wizard.redis, password: e.target.value } })}
                />
              </Form.Item>
            </Form>
          </Card>
        );
      case 6:
        return (
          <Card title="MinIO (object storage)">
            <Paragraph type="secondary">
              Shared platform MinIO started with the stack. Each project gets its own bucket
              (proj-{'{id}'}) — no per-project MinIO containers.
            </Paragraph>
            <SourceRadios
              value={wizard.minio.source}
              onChange={(source) =>
                update({
                  minio: {
                    ...wizard.minio,
                    source,
                    host:
                      source === 'bundled'
                        ? 'platform-shared-minio-storage'
                        : wizard.minio.host,
                  },
                })
              }
              bundledLabel="Install shared MinIO for me"
              externalLabel="Use existing MinIO / S3"
            />
            <Form layout="vertical">
              <Form.Item label="Host" required>
                <Input
                  value={wizard.minio.host}
                  onChange={(e) => update({ minio: { ...wizard.minio, host: e.target.value } })}
                />
              </Form.Item>
              <Form.Item label="Port" required>
                <InputNumber
                  value={wizard.minio.port}
                  onChange={(v) => update({ minio: { ...wizard.minio, port: v || 9000 } })}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item label="Access key" required>
                <Input
                  value={wizard.minio.access_key}
                  onChange={(e) => update({ minio: { ...wizard.minio, access_key: e.target.value } })}
                />
              </Form.Item>
              <Form.Item label="Secret key" required>
                <Input.Password
                  value={wizard.minio.secret_key}
                  onChange={(e) => update({ minio: { ...wizard.minio, secret_key: e.target.value } })}
                />
              </Form.Item>
              <Form.Item label="Bucket" required>
                <Input
                  value={wizard.minio.bucket}
                  onChange={(e) => update({ minio: { ...wizard.minio, bucket: e.target.value } })}
                />
              </Form.Item>
            </Form>
          </Card>
        );
      case 7:
        return (
          <Card title="Centrifugo (realtime notifications)">
            <Paragraph type="secondary">
              Shared platform Centrifugo starts with the stack. Projects are isolated by channel
              (org / workspace) — no per-org broker containers.
            </Paragraph>
            <SourceRadios
              value={wizard.centrifugo.source}
              onChange={(source) =>
                update({
                  centrifugo: {
                    ...wizard.centrifugo,
                    source,
                    host: source === 'bundled' ? 'centrifugo' : wizard.centrifugo.host,
                    http_port: source === 'bundled' ? 8000 : wizard.centrifugo.http_port || 8001,
                  },
                })
              }
              bundledLabel="Install Centrifugo for me"
              externalLabel="Use existing Centrifugo"
            />
            <Form layout="vertical">
              <Form.Item label="Host" required>
                <Input
                  value={wizard.centrifugo.host}
                  onChange={(e) => update({ centrifugo: { ...wizard.centrifugo, host: e.target.value } })}
                />
              </Form.Item>
              <Form.Item label="HTTP port" required>
                <InputNumber
                  value={wizard.centrifugo.http_port}
                  onChange={(v) => update({ centrifugo: { ...wizard.centrifugo, http_port: v || 8001 } })}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item label="API key" required>
                <Input.Password
                  value={wizard.centrifugo.api_key}
                  onChange={(e) => update({ centrifugo: { ...wizard.centrifugo, api_key: e.target.value } })}
                />
              </Form.Item>
              <Form.Item label="Token HMAC secret" required>
                <Input.Password
                  value={wizard.centrifugo.token_hmac_secret_key}
                  onChange={(e) => update({
                    centrifugo: { ...wizard.centrifugo, token_hmac_secret_key: e.target.value },
                  })}
                />
              </Form.Item>
            </Form>
          </Card>
        );
      case 8:
        return (
          <Card title="Grafana (monitoring)">
            <Paragraph type="secondary">
              Optional dashboards for container CPU, memory, and network (Prometheus + Grafana).
              You can install a stack on this server or point at an existing Grafana.
            </Paragraph>
            <Radio.Group
              value={wizard.grafana.source}
              onChange={(e) => {
                const source = e.target.value as 'bundled' | 'external' | 'skip';
                update({
                  grafana: {
                    ...wizard.grafana,
                    source,
                  },
                });
              }}
              style={{ marginBottom: 16 }}
            >
              <Space direction="vertical">
                <Radio value="bundled">
                  <Text strong>Install Grafana for me</Text>
                  <br />
                  <Text type="secondary">Starts Prometheus, Grafana, and cAdvisor with the platform.</Text>
                </Radio>
                <Radio value="external">
                  <Text strong>Connect to existing Grafana</Text>
                  <br />
                  <Text type="secondary">Use a Grafana you already run (URL only).</Text>
                </Radio>
                <Radio value="skip">
                  <Text strong>Skip for now</Text>
                </Radio>
              </Space>
            </Radio.Group>
            {wizard.grafana.source === 'bundled' && (
              <Form layout="vertical">
                <Form.Item
                  label="Grafana port"
                  required
                  extra="Open http://your-server:port after install. Allow this port in your security group."
                >
                  <InputNumber
                    value={wizard.grafana.port}
                    onChange={(v) => update({ grafana: { ...wizard.grafana, port: v || 3002 } })}
                    style={{ width: '100%' }}
                    min={1}
                    max={65535}
                  />
                </Form.Item>
                <Form.Item label="Admin username" required>
                  <Input
                    value={wizard.grafana.admin_user}
                    onChange={(e) => update({ grafana: { ...wizard.grafana, admin_user: e.target.value } })}
                    autoComplete="off"
                  />
                </Form.Item>
                <Form.Item
                  label="Admin password"
                  required
                  extra="At least 8 characters. Change this before exposing the port publicly."
                  validateStatus={
                    wizard.grafana.admin_password.length > 0 && wizard.grafana.admin_password.length < 8
                      ? 'error'
                      : undefined
                  }
                  help={
                    wizard.grafana.admin_password.length > 0 && wizard.grafana.admin_password.length < 8
                      ? 'Password must be at least 8 characters.'
                      : undefined
                  }
                >
                  <Input.Password
                    value={wizard.grafana.admin_password}
                    onChange={(e) => update({ grafana: { ...wizard.grafana, admin_password: e.target.value } })}
                    autoComplete="new-password"
                  />
                </Form.Item>
              </Form>
            )}
            {wizard.grafana.source === 'external' && (
              <Form layout="vertical">
                <Form.Item
                  label="Grafana URL"
                  required
                  extra="Example: https://grafana.mycompany.com or http://10.0.0.5:3000"
                  validateStatus={
                    wizard.grafana.url.trim()
                    && !(
                      wizard.grafana.url.trim().startsWith('http://')
                      || wizard.grafana.url.trim().startsWith('https://')
                    )
                      ? 'error'
                      : undefined
                  }
                  help={
                    wizard.grafana.url.trim()
                    && !(
                      wizard.grafana.url.trim().startsWith('http://')
                      || wizard.grafana.url.trim().startsWith('https://')
                    )
                      ? 'URL must start with http:// or https://'
                      : undefined
                  }
                >
                  <Input
                    value={wizard.grafana.url}
                    onChange={(e) => update({ grafana: { ...wizard.grafana, url: e.target.value } })}
                    placeholder="https://grafana.example.com"
                  />
                </Form.Item>
              </Form>
            )}
          </Card>
        );
      case 9:
        return (
          <Card title="Your administrator account">
            <Paragraph type="secondary">
              You will use this to sign in after installation.
            </Paragraph>
            <Form layout="vertical">
              <Form.Item
                label="Username"
                required
                validateStatus={
                  accountTouched && wizard.superadmin_username.trim().length < MIN_USERNAME_LENGTH
                    ? 'error'
                    : undefined
                }
                help={
                  accountTouched && wizard.superadmin_username.trim().length < MIN_USERNAME_LENGTH
                    ? `Username must be at least ${MIN_USERNAME_LENGTH} characters.`
                    : undefined
                }
              >
                <Input
                  value={wizard.superadmin_username}
                  onChange={(e) => update({ superadmin_username: e.target.value })}
                  onBlur={() => setAccountTouched(true)}
                  autoComplete="username"
                />
              </Form.Item>
              <Form.Item
                label="Password"
                required
                validateStatus={
                  accountTouched && wizard.superadmin_password.length < MIN_PASSWORD_LENGTH
                    ? 'error'
                    : undefined
                }
                help={
                  accountTouched && wizard.superadmin_password.length < MIN_PASSWORD_LENGTH
                    ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
                    : undefined
                }
              >
                <Input.Password
                  value={wizard.superadmin_password}
                  onChange={(e) => update({ superadmin_password: e.target.value })}
                  onBlur={() => setAccountTouched(true)}
                  autoComplete="new-password"
                />
              </Form.Item>
              <Form.Item label="Email (optional)">
                <Input
                  value={wizard.superadmin_email}
                  onChange={(e) => update({ superadmin_email: e.target.value })}
                  autoComplete="email"
                />
              </Form.Item>
            </Form>
          </Card>
        );
      case 10:
        if (wizard.deployment_mode === 'monolith') {
          return (
            <Card title="Your website address">
              <Paragraph type="secondary">
                Enter the address people will use to open DT Orch in a browser (usually this server&apos;s public IP or domain name).
              </Paragraph>
              <Form layout="vertical">
                <Form.Item
                  label="Address"
                  extra="Example: 13.200.160.10 or studio.mycompany.com — not an email address"
                  validateStatus={
                    wizard.monolith.public_host.includes('@') ? 'error' : undefined
                  }
                  help={
                    wizard.monolith.public_host.includes('@')
                      ? 'Enter this server’s public IP or domain, not an email'
                      : undefined
                  }
                >
                  <Input
                    value={wizard.monolith.public_host}
                    onChange={(e) => update({ monolith: { ...wizard.monolith, public_host: e.target.value } })}
                    placeholder="13.200.160.10"
                  />
                </Form.Item>
                <Form.Item label="HTTP port">
                  <InputNumber
                    value={wizard.monolith.http_port}
                    onChange={(v) => update({ monolith: { ...wizard.monolith, http_port: v || 80 } })}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Form>
            </Card>
          );
        }
        return (
          <Card title="Website / ingress">
            <Paragraph type="secondary">Complete website settings for this install mode.</Paragraph>
          </Card>
        );
      case 11:
        return (
          <Card title="Ready to install">
            <Descriptions bordered column={1} size="middle">
              <Descriptions.Item label="Product">{wizard.app_name}</Descriptions.Item>
              <Descriptions.Item label="Version">{installDefaults?.platform_version ?? wizard.image_tag.replace(/^v/, '')}</Descriptions.Item>
              <Descriptions.Item label="Install type">Single server</Descriptions.Item>
              <Descriptions.Item label="Administrator">{wizard.superadmin_username || '—'}</Descriptions.Item>
              <Descriptions.Item label="Studio SQL">
                {wizard.workspace_sql.engine === 'mysql' ? 'MySQL' : 'PostgreSQL'}
                {' — '}
                {wizard.workspace_sql.source === 'bundled' ? 'Included' : 'External'}
                {' '}
                {wizard.workspace_sql.host}:{wizard.workspace_sql.port}
                {' / '}
                {wizard.workspace_sql.database_name}
              </Descriptions.Item>
              <Descriptions.Item label="MongoDB">
                {wizard.mongo.source === 'skip'
                  ? 'Skipped'
                  : wizard.mongo.source === 'bundled'
                    ? `Included — ${wizard.mongo.host}:${wizard.mongo.port}`
                    : `External — ${wizard.mongo.host}:${wizard.mongo.port}`}
              </Descriptions.Item>
              <Descriptions.Item label="Keycloak">
                {wizard.keycloak.host}:{wizard.keycloak.port} ({wizard.keycloak.realm})
              </Descriptions.Item>
              <Descriptions.Item label="Redis">
                {wizard.redis.host}:{wizard.redis.port}
              </Descriptions.Item>
              <Descriptions.Item label="MinIO">
                {wizard.minio.host}:{wizard.minio.port}/{wizard.minio.bucket}
              </Descriptions.Item>
              <Descriptions.Item label="Centrifugo">
                {wizard.centrifugo.host}:{wizard.centrifugo.http_port}
              </Descriptions.Item>
              <Descriptions.Item label="Grafana">
                {wizard.grafana.source === 'skip'
                  ? 'Skipped'
                  : wizard.grafana.source === 'bundled'
                    ? `Install on port ${wizard.grafana.port}`
                    : `Connect — ${wizard.grafana.url}`}
              </Descriptions.Item>
              <Descriptions.Item label="Website">
                {wizard.monolith.public_host
                  ? `http://${wizard.monolith.public_host}`
                  : '—'}
              </Descriptions.Item>
            </Descriptions>
            <Button type="primary" size="large" onClick={runDeploy} style={{ marginTop: 24 }}>
              Install DT Orch
            </Button>
          </Card>
        );
      case 12:
        return (
          <Card title={jobKind === 'upgrade' ? 'Upgrading…' : 'Installing…'}>
            <Paragraph>
              {jobKind === 'upgrade'
                ? 'Please wait while DT Orch is upgraded. Your data will be kept.'
                : 'Please wait while DT Orch is installed. This may take several minutes.'}
            </Paragraph>
            {phase.label && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text strong>Stage: {phase.label}</Text>
                  <Text type="secondary">{phase.progress}%</Text>
                </div>
                <Progress
                  percent={phase.progress}
                  status={deployError ? 'exception' : phase.progress >= 100 ? 'success' : 'active'}
                  showInfo={false}
                />
              </div>
            )}
            {deployError && (
              <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
                <Alert message={deployError} type="error" />
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  Copy the support report below and send it to your vendor so they can diagnose the failure.
                </Paragraph>
                <Button onClick={copySupportReport}>Copy support report</Button>
              </Space>
            )}
            <div className="installer-log-viewer">
              {logs.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
              <div ref={bottomRef} />
            </div>
          </Card>
        );
      case 13:
        return (
          <>
            <Result
              status="success"
              title={jobKind === 'upgrade' && !deployError ? 'Upgrade complete' : 'DT Orch is ready'}
              subTitle={
                alreadyInstalled && jobKind !== 'upgrade'
                  ? 'DT Orch is already installed on this server.'
                  : jobKind === 'upgrade'
                    ? `DT Orch is now on ${upgradeInfo?.current_tag ?? 'the latest release'}.`
                    : 'You can sign in now.'
              }
              extra={[
                <Paragraph key="u">
                  Open:{' '}
                  <Link href={loginUrl} target="_blank" rel="noreferrer">{loginUrl || '/login'}</Link>
                </Paragraph>,
                wizard.superadmin_username ? (
                  <Paragraph key="a">Administrator: <Text strong>{wizard.superadmin_username}</Text></Paragraph>
                ) : null,
                wizard.grafana.source === 'bundled' ? (
                  <Paragraph key="g">
                    Grafana:{' '}
                    <Link
                      href={`http://${wizard.monolith.public_host || 'localhost'}:${wizard.grafana.port}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {`http://${wizard.monolith.public_host || 'localhost'}:${wizard.grafana.port}`}
                    </Link>
                    {' '}(user: {wizard.grafana.admin_user})
                  </Paragraph>
                ) : wizard.grafana.source === 'external' && wizard.grafana.url ? (
                  <Paragraph key="g">
                    Grafana:{' '}
                    <Link href={wizard.grafana.url} target="_blank" rel="noreferrer">
                      {wizard.grafana.url}
                    </Link>
                  </Paragraph>
                ) : null,
                <Button type="primary" key="go" href={loginUrl || '/login'}>Open DT Orch</Button>,
              ].filter(Boolean)}
            />
            {upgradeInfo?.upgrade_available && (
              <Card title="Software update available" style={{ marginTop: 16 }}>
                <Paragraph>
                  Installed: <Text code>{upgradeInfo.current_tag}</Text>
                  {' → '}
                  Available: <Text code>{upgradeInfo.available_tag}</Text>
                </Paragraph>
                <Button type="primary" size="large" onClick={runUpgrade}>
                  Upgrade to {upgradeInfo.available_tag}
                </Button>
              </Card>
            )}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <Layout className="installer-layout">
      <Header className="installer-header">
        <InstallerBrand variant="header" />
      </Header>
      <Layout className="installer-body">
        <Sider width={220} className="installer-sider" breakpoint="lg" collapsedWidth={0}>
          <Steps
            direction="vertical"
            size="small"
            current={Math.min(step, DONE_STEP)}
            onChange={goToStep}
            items={STEP_LABELS.map((title, index) => ({
              title,
              disabled: index > step || (step >= INSTALLING_STEP && index < INSTALLING_STEP),
            }))}
          />
        </Sider>
        <Content className="installer-main">
          {renderStep()}
          {step > 0 && step < LAST_FORM_STEP && (
            <Space style={{ marginTop: 16 }}>
              <Button onClick={back}>Back</Button>
              <Button type="primary" onClick={() => void next()} disabled={nextDisabled}>Next</Button>
            </Space>
          )}
          {step === LAST_FORM_STEP && (
            <Space style={{ marginTop: 16 }}>
              <Button onClick={back}>Back</Button>
            </Space>
          )}
          {step === 0 && (
            <Button type="primary" onClick={() => void next()} style={{ marginTop: 16 }} size="large">
              Get started
            </Button>
          )}
        </Content>
      </Layout>
    </Layout>
  );
}
