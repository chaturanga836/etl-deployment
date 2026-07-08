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
  requestTrialLicense,
  startDeploy,
  startUpgrade,
  validateDatabase,
  validateLicense,
  type DeployJobSnapshot,
  type HostInfo,
  type InstallDefaults,
  type Prerequisites,
  type UpgradeInfo,
  type WizardState,
} from './api';
import { useDeployEvents } from './useDeployEvents';
import InstallerBrand from './components/InstallerBrand';
import { BRAND_NAME } from './constants/brand';
import './App.css';

const { Header, Content } = Layout;
const { Paragraph, Text, Link } = Typography;

const MIN_USERNAME_LENGTH = 3;
const MIN_PASSWORD_LENGTH = 8;

/** Compact step labels — full titles are shown on each card. */
const USER_STEP_LABELS = [
  'Welcome',
  'Type',
  'Account',
  'Database',
  'License',
  'Website',
  'Confirm',
  'Installing',
  'Done',
];

function isAccountStepValid(wizard: WizardState): boolean {
  return (
    wizard.superadmin_username.trim().length >= MIN_USERNAME_LENGTH
    && wizard.superadmin_password.length >= MIN_PASSWORD_LENGTH
  );
}

function isDatabaseStepValid(wizard: WizardState, dbValidated: boolean): boolean {
  if (wizard.database.source === 'bundled') {
    return true;
  }
  const { host, user, password } = wizard.database;
  return Boolean(host.trim() && user.trim() && password) && dbValidated;
}

function isWebsiteStepValid(wizard: WizardState): boolean {
  return wizard.monolith.public_host.trim().length > 0;
}

function userStepIndex(internal: number): number {
  return internal <= 1 ? internal : internal - 1;
}

function skipPackagesStep(internal: number, delta: number): number {
  let n = internal + delta;
  if (delta > 0 && n === 2) n = 3;
  if (delta < 0 && n === 2) n = 1;
  return Math.max(0, Math.min(n, 9));
}

export default function App() {
  const [step, setStep] = useState(0);
  const [wizard, setWizard] = useState<WizardState>(defaultWizard);
  const [prereqs, setPrereqs] = useState<Prerequisites | null>(null);
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [installDefaults, setInstallDefaults] = useState<InstallDefaults | null>(null);
  const [licenseMode, setLicenseMode] = useState<'license' | 'trial'>('license');
  const [licenseValidated, setLicenseValidated] = useState(false);
  const [licenseInfo, setLicenseInfo] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [loginUrl, setLoginUrl] = useState('');
  const [deployError, setDeployError] = useState('');
  const [alreadyInstalled, setAlreadyInstalled] = useState<{ login_url?: string } | null>(null);
  const [upgradeInfo, setUpgradeInfo] = useState<UpgradeInfo | null>(null);
  const [jobKind, setJobKind] = useState<'deploy' | 'upgrade'>('deploy');
  const [prereqsLoading, setPrereqsLoading] = useState(false);
  const [dbValidated, setDbValidated] = useState(false);
  const [accountTouched, setAccountTouched] = useState(false);

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
    setStep(9);
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
    setStep(8);
    setDeployError(snapshot.status === 'failed' ? snapshot.error || 'Installation failed' : '');
    persistActiveJob(snapshot.job_id, snapshot.kind);
  }, []);

  useEffect(() => {
    const load = async () => {
      fetchPrerequisites().then(setPrereqs).catch(() => {});
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
        setStep(9);
        return;
      }

      const upgradeInfoResult = await fetchUpgradeInfo().catch(() => null);
      if (upgradeInfoResult) {
        setUpgradeInfo(upgradeInfoResult);
        if (upgradeInfoResult.installed && upgradeInfoResult.login_url) {
          setLoginUrl(upgradeInfoResult.login_url);
          setAlreadyInstalled((prev) => prev ?? { login_url: upgradeInfoResult.login_url ?? undefined });
          setStep(9);
          return;
        }
      }

      const active = await fetchActiveDeployJob();
      if (active) {
        resumeDeployJob(active);
        return;
      }

      const storedJobId = sessionStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
      if (!storedJobId) {
        return;
      }

      try {
        const status = await fetchDeployStatus(storedJobId);
        if (status.status === 'pending' || status.status === 'running' || status.status === 'failed') {
          resumeDeployJob(status);
        } else {
          clearActiveJob();
        }
      } catch {
        clearActiveJob();
      }
    };

    void load();
  }, [resumeDeployJob]);

  const update = (patch: Partial<WizardState>) => setWizard((w) => ({ ...w, ...patch }));

  const next = async () => {
    if (step === 3) {
      setAccountTouched(true);
      if (!isAccountStepValid(wizard)) {
        message.warning(
          `Enter a username (${MIN_USERNAME_LENGTH}+ characters) and password (${MIN_PASSWORD_LENGTH}+ characters).`,
        );
        return;
      }
    }
    if (step === 4) {
      if (!isDatabaseStepValid(wizard, dbValidated)) {
        if (wizard.database.source === 'external') {
          message.warning('Fill in database connection details and click Test connection before continuing.');
        }
        return;
      }
    }
    if (step === 6 && wizard.deployment_mode === 'monolith') {
      if (!isWebsiteStepValid(wizard)) {
        message.warning('Enter the website address people will use to open DT Orch.');
        return;
      }
    }
    if (step === 5 && licenseMode === 'trial') {
      try {
        const trial = await requestTrialLicense();
        update({ license_key: trial.license_key });
        setLicenseInfo(`Free trial until ${trial.expires_at?.slice(0, 10) ?? '—'}`);
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Could not start free trial');
        return;
      }
    }
    if (step === 8) return;
    setStep((s) => skipPackagesStep(s, 1));
  };

  const nextDisabled = (
    (step === 3 && !isAccountStepValid(wizard))
    || (step === 4 && !isDatabaseStepValid(wizard, dbValidated))
    || (step === 5 && licenseMode === 'license' && !licenseValidated)
    || (step === 6 && wizard.deployment_mode === 'monolith' && !isWebsiteStepValid(wizard))
  );

  const back = () => setStep((s) => skipPackagesStep(s, -1));

  const runDeploy = async () => {
    setDeployError('');
    setJobKind('deploy');
    try {
      const id = await startDeploy(wizard);
      persistActiveJob(id, 'deploy');
      setJobId(id);
      setStep(8);
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
      setStep(8);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Upgrade failed');
    }
  };

  const testDb = async () => {
    try {
      await validateDatabase(wizard.database);
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
            {!prereqs?.docker.available && (
              <Alert type="warning" message="Docker must be installed on this server before you continue." style={{ marginTop: 16 }} />
            )}
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
                      <>
                        <Text>
                          DT Orch release images should be publicly downloadable — you do{' '}
                          <Text strong>not</Text> need the vendor&apos;s GitHub account or token.
                          Images are still protected inside the container (compiled binaries, not source code).
                        </Text>
                        <Text>
                          This server was denied access — the vendor must publish packages as{' '}
                          <Text strong>public</Text> on GitHub Container Registry. Contact support if you
                          just received this installer.
                        </Text>
                      </>
                    )}
                    {prereqs.registry.public && prereqs.registry.error === 'not_found' && (
                      <Space direction="vertical" size="small">
                        <Text>
                          One or more release images were not found. The vendor may not have published
                          this version yet.
                        </Text>
                        {prereqs.registry.images && (
                          <ul style={{ margin: 0, paddingLeft: 20 }}>
                            {Object.entries(prereqs.registry.images).map(([name, info]) => (
                              <li key={name}>
                                <Text code>{info.image}</Text>
                                {' — '}
                                {info.accessible ? 'OK' : info.error ?? 'missing'}
                              </li>
                            ))}
                          </ul>
                        )}
                      </Space>
                    )}
                    {prereqs.registry.public && prereqs.registry.error === 'unreachable' && (
                      <Text>
                        Cannot reach <Text code>{prereqs.registry.url}</Text>. Check outbound HTTPS and
                        firewall rules, or use an offline install bundle if your environment has no internet.
                      </Text>
                    )}
                    {!prereqs.registry.public && (
                      <>
                        <Text>
                          Images are in a private registry. Use <Text strong>your own</Text> GitHub account
                          after your vendor grants you package read access — not the vendor&apos;s token.
                        </Text>
                        <Text>
                          On the server where you ran <Text code>setup-ui.sh</Text>, open SSH and run:
                        </Text>
                        <Text code>
                          echo &quot;&lt;YOUR_GITHUB_PAT&gt;&quot; | docker login ghcr.io -u &lt;your-github-user&gt; --password-stdin
                        </Text>
                        <Text type="secondary">
                          Your PAT needs <Text code>read:packages</Text>.
                        </Text>
                      </>
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
                      {prereqs.registry && (
                        <Text>
                          Registry ({prereqs.registry.url}):{' '}
                          {prereqs.registry.local_build
                            ? 'local build'
                            : prereqs.registry.accessible === true
                              ? 'reachable'
                              : prereqs.registry.accessible === false
                                ? prereqs.registry.public
                                  ? `unavailable (${prereqs.registry.error ?? 'error'})`
                                  : 'denied — your GitHub login required'
                                : 'not checked'}
                        </Text>
                      )}
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
      case 3:
        return (
          <Card title="Your administrator account">
            <Paragraph type="secondary">
              You will use this to sign in after installation.
            </Paragraph>
            <Form
              layout="vertical"
              onFinish={() => {
                setAccountTouched(true);
                if (!isAccountStepValid(wizard)) {
                  message.warning(
                    `Enter a username (${MIN_USERNAME_LENGTH}+ characters) and password (${MIN_PASSWORD_LENGTH}+ characters).`,
                  );
                  return;
                }
                void next();
              }}
            >
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
      case 4:
        return (
          <Card title="Database">
            <Radio.Group
              value={wizard.database.source}
              onChange={(e) => {
                setDbValidated(false);
                update({ database: { ...wizard.database, source: e.target.value } });
              }}
              style={{ marginBottom: 16 }}
            >
              <Space direction="vertical">
                <Radio value="bundled">
                  <Text strong>Install database for me</Text>
                  <br />
                  <Text type="secondary">Recommended for a new server.</Text>
                </Radio>
                <Radio value="external">
                  <Text strong>Use my existing database</Text>
                </Radio>
              </Space>
            </Radio.Group>
            {wizard.database.source === 'external' && (
              <Form layout="vertical">
                <Form.Item label="Host" required>
                  <Input
                    value={wizard.database.host}
                    onChange={(e) => {
                      setDbValidated(false);
                      update({ database: { ...wizard.database, host: e.target.value } });
                    }}
                  />
                </Form.Item>
                <Form.Item label="Port" required>
                  <InputNumber
                    value={wizard.database.port}
                    onChange={(v) => {
                      setDbValidated(false);
                      update({ database: { ...wizard.database, port: v || 5432 } });
                    }}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
                <Form.Item label="Username" required>
                  <Input
                    value={wizard.database.user}
                    onChange={(e) => {
                      setDbValidated(false);
                      update({ database: { ...wizard.database, user: e.target.value } });
                    }}
                  />
                </Form.Item>
                <Form.Item label="Password" required>
                  <Input.Password
                    value={wizard.database.password}
                    onChange={(e) => {
                      setDbValidated(false);
                      update({ database: { ...wizard.database, password: e.target.value } });
                    }}
                  />
                </Form.Item>
                <Space>
                  <Button type="primary" onClick={testDb}>Test connection</Button>
                  {dbValidated && <Text type="success">Connection verified</Text>}
                </Space>
                {!dbValidated && (
                  <Paragraph type="secondary" style={{ marginTop: 12 }}>
                    Test the connection before continuing.
                  </Paragraph>
                )}
              </Form>
            )}
          </Card>
        );
      case 5:
        return (
          <Card title="License">
            <Radio.Group
              value={licenseMode}
              onChange={(e) => {
                const mode = e.target.value as 'license' | 'trial';
                setLicenseMode(mode);
                setLicenseValidated(false);
                setLicenseInfo(null);
                update({ license_key: '' });
              }}
              style={{ marginBottom: 16 }}
            >
              <Space direction="vertical">
                <Radio value="license">
                  <Text strong>Activate license</Text>
                  <br />
                  <Text type="secondary">I have a license key from my vendor.</Text>
                </Radio>
                <Radio value="trial">
                  <Text strong>Free trial</Text>
                  <br />
                  <Text type="secondary">3-month trial — no license key required.</Text>
                </Radio>
              </Space>
            </Radio.Group>
            {licenseMode === 'license' && (
              <Form layout="vertical">
                <Form.Item label="License key" required>
                  <Input.TextArea
                    rows={4}
                    value={wizard.license_key}
                    onChange={(e) => {
                      update({ license_key: e.target.value });
                      setLicenseValidated(false);
                      setLicenseInfo(null);
                    }}
                    placeholder="Paste your license key here"
                  />
                </Form.Item>
                <Space>
                  <Button
                    type="primary"
                    disabled={!wizard.license_key.trim()}
                    onClick={async () => {
                      try {
                        const info = await validateLicense(wizard.license_key);
                        setLicenseValidated(true);
                        setLicenseInfo(
                          `Valid — ${info.edition} edition${info.expires_at ? `, expires ${info.expires_at.slice(0, 10)}` : ''}`,
                        );
                        message.success('License validated');
                      } catch (e) {
                        setLicenseValidated(false);
                        setLicenseInfo(null);
                        message.error(e instanceof Error ? e.message : 'Invalid license');
                      }
                    }}
                  >
                    Validate license
                  </Button>
                  {licenseValidated && licenseInfo && (
                    <Text type="success">{licenseInfo}</Text>
                  )}
                </Space>
                {!licenseValidated && (
                  <Paragraph type="secondary" style={{ marginTop: 12 }}>
                    Validate your license before continuing.
                  </Paragraph>
                )}
              </Form>
            )}
            {licenseMode === 'trial' && (
              <Alert
                type="info"
                showIcon
                message="Free trial selected"
                description="Click Next to activate your 3-month trial and continue."
              />
            )}
          </Card>
        );
      case 6:
        if (wizard.deployment_mode === 'monolith') {
          return (
            <Card title="Your website address">
              <Paragraph type="secondary">
                Enter the address people will use to open DT Orch in a browser (usually this server&apos;s public IP or domain name).
              </Paragraph>
              <Form layout="vertical">
                <Form.Item label="Address" extra="Example: 13.200.160.10 or studio.mycompany.com">
                  <Input
                    value={wizard.monolith.public_host}
                    onChange={(e) => update({ monolith: { ...wizard.monolith, public_host: e.target.value } })}
                    placeholder="13.200.160.10"
                  />
                </Form.Item>
              </Form>
            </Card>
          );
        }
        if (wizard.deployment_mode === 'kubernetes') {
          return (
            <Card title="Kubernetes settings">
              <Form layout="vertical">
                <Form.Item label="Namespace">
                  <Input value={wizard.kubernetes.namespace} onChange={(e) => update({ kubernetes: { ...wizard.kubernetes, namespace: e.target.value } })} />
                </Form.Item>
                <Form.Item label="Ingress host" required>
                  <Input value={wizard.kubernetes.ingress_host} onChange={(e) => update({ kubernetes: { ...wizard.kubernetes, ingress_host: e.target.value } })} />
                </Form.Item>
              </Form>
            </Card>
          );
        }
        return (
          <Card title="Server addresses">
            <Form layout="vertical">
              {Object.entries(wizard.distributed.services).map(([name, svc]) => (
                <Form.Item key={name} label={name}>
                  <Input
                    value={svc.host}
                    onChange={(e) => update({
                      distributed: {
                        services: {
                          ...wizard.distributed.services,
                          [name]: { ...svc, host: e.target.value },
                        },
                      },
                    })}
                  />
                </Form.Item>
              ))}
            </Form>
          </Card>
        );
      case 7:
        return (
          <Card title="Ready to install">
            <Descriptions bordered column={1} size="middle">
              <Descriptions.Item label="Product">{wizard.app_name}</Descriptions.Item>
              <Descriptions.Item label="Version">{installDefaults?.platform_version ?? wizard.image_tag.replace(/^v/, '')}</Descriptions.Item>
              <Descriptions.Item label="Install type">Single server</Descriptions.Item>
              <Descriptions.Item label="Administrator">{wizard.superadmin_username || '—'}</Descriptions.Item>
              <Descriptions.Item label="Database">
                {wizard.database.source === 'bundled' ? 'Included with install' : 'Your existing database'}
              </Descriptions.Item>
              <Descriptions.Item label="License">
                {licenseMode === 'trial' || !wizard.license_key
                  ? '3-month free trial'
                  : 'Licensed'}
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
      case 8:
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
      case 9:
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
                <Paragraph type="secondary">
                  Upgrades pull new release images and restart platform services. Your database and settings are kept.
                </Paragraph>
                <Button type="primary" size="large" onClick={runUpgrade}>
                  Upgrade to {upgradeInfo.available_tag}
                </Button>
              </Card>
            )}
            {upgradeInfo?.installed && !upgradeInfo.upgrade_available && upgradeInfo.current_tag && (
              <Alert
                type="success"
                showIcon
                style={{ marginTop: 16 }}
                message={`DT Orch is up to date (${upgradeInfo.current_tag})`}
              />
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
      <Content className="installer-content">
        <div className="installer-steps">
          <Steps
            current={userStepIndex(step)}
            items={USER_STEP_LABELS.map((t) => ({ title: t }))}
            size="small"
            labelPlacement="vertical"
          />
        </div>
        {renderStep()}
        {step > 0 && step < 8 && step !== 7 && (
          <Space style={{ marginTop: 16 }}>
            <Button onClick={back}>Back</Button>
            <Button type="primary" onClick={next} disabled={nextDisabled}>Next</Button>
          </Space>
        )}
        {step === 0 && (
          <Button type="primary" onClick={next} style={{ marginTop: 16 }} size="large">Get started</Button>
        )}
      </Content>
    </Layout>
  );
}
